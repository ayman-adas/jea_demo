const twilio = require('twilio');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { uploadToFTP } = require('../config/ftp');
const { Customer, User, Session, Message, ServiceCategory, QA, Ticket, Notification, EmployeeServiceCategory, Rating } = require('../models');
const { getTranslation } = require('../config/localization');
const { getAnswer } = require('../services/qaEngine');

// Helper to download media from a URL, recursively following HTTP redirects
const downloadMediaWithRedirect = (url, destPath) => {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (response) => {
      // Follow HTTP redirects (301, 302, 303, 307, 308)
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        console.log(`Following download redirect to: ${response.headers.location}`);
        return downloadMediaWithRedirect(response.headers.location, destPath)
          .then(resolve)
          .catch(reject);
      }

      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to download media: Status ${response.statusCode}`));
      }

      const file = fs.createWriteStream(destPath);
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
};

// Helper to process incoming media attachments and upload them to local FTP
const processIncomingMedia = async (reqBody) => {
  const numMedia = Number.parseInt(reqBody.NumMedia || '0', 10);
  if (numMedia === 0) return null;

  const mediaAttachments = [];
  for (let i = 0; i < numMedia; i++) {
    const mediaUrl = reqBody[`MediaUrl${i}`];
    const contentType = reqBody[`MediaContentType${i}`];

    // Verify format is image or pdf
    const isImage = contentType?.startsWith('image/');
    const isPdf = contentType === 'application/pdf';

    if (!isImage && !isPdf) {
      throw new Error('Unsupported attachment format. Only images and PDFs are allowed.');
    }

    // Temporary storage path
    const ext = isPdf ? '.pdf' : '.jpg';
    const tempFileName = `twilio_${Date.now()}_${i}${ext}`;
    const tempPath = path.join(__dirname, '..', '..', 'tmp_uploads', tempFileName);

    console.log(`Downloading Twilio media: ${mediaUrl} -> ${tempPath}`);

    // Download following redirects
    await downloadMediaWithRedirect(mediaUrl, tempPath);

    // Upload to FTP
    console.log(`Uploading media to FTP: ${tempFileName}`);
    const ftpUrl = await uploadToFTP(tempPath, tempFileName);

    // Clean up local temp file
    fs.unlink(tempPath, (err) => {
      if (err) console.error('Failed to delete temp media file:', err.message);
    });

    mediaAttachments.push({
      url: ftpUrl,
      type: isPdf ? 'DOCUMENT' : 'IMAGE'
    });
  }
  return mediaAttachments;
};

// Automatic geolocation detection based on Jordanian phone number prefix
const detectRegionByPhone = (phone) => {
  const clean = phone.replace(/\D/g, '');
  if (clean.includes('96279') || clean.startsWith('079') || clean.startsWith('79')) {
    return 'Amman (Central Region)';
  } else if (clean.includes('96278') || clean.startsWith('078') || clean.startsWith('78')) {
    return 'Irbid (Northern Region)';
  } else if (clean.includes('96277') || clean.startsWith('077') || clean.startsWith('77')) {
    return 'Aqaba (Southern Region)';
  }
  return 'Jordan (General)';
};

// In-memory chatbot state map (phone -> state)
const sessionStates = new Map();

// Helper to get client (lazy initialization)
const getTwilioClient = () => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken || accountSid.startsWith('ACXXXX')) {
    throw new Error('Twilio credentials are not configured or are placeholder values in .env');
  }
  return twilio(accountSid, authToken);
};

// Helper to format WhatsApp phone numbers
const formatWhatsAppNumber = (number) => {
  if (!number) return '';
  const trimmed = number.trim();
  if (trimmed.startsWith('whatsapp:')) {
    return trimmed;
  }
  return `whatsapp:${trimmed.startsWith('+') ? trimmed : '+' + trimmed}`;
};

// Helper to log messages in database
const recordMessage = async (sessionId, content, from, messageType) => {
  try {
    const timestampStr = new Date().toISOString();
    const messageId = 'msg_' + crypto.randomUUID();
    await Message.create({
      message_id: messageId,
      session_id: sessionId,
      content,
      from,
      message_type: messageType || 'TEXT',
      status: 'SENT',
      created_at: timestampStr,
      updated_at: timestampStr
    });
  } catch (err) {
    console.error('Failed to log message to database:', err.message);
  }
};

// Helper to discover the public URL (checks local ngrok agent API, falling back to host header)
const getPublicUrl = async (req) => {
  try {
    const response = await new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:4040/api/tunnels', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
    if (response.tunnels && response.tunnels.length > 0) {
      const httpsTunnel = response.tunnels.find(t => t.proto === 'https' || t.public_url.startsWith('https'));
      if (httpsTunnel) return httpsTunnel.public_url;
      return response.tunnels[0].public_url;
    }
  } catch (err) {
    console.debug('ngrok tunnels local check failed:', err.message);
  }
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}`;
};

/**
 * Send a WhatsApp message
 * POST /api/whatsapp/send
 * Body: { "to": "+1234567890", "message": "Hello World!", "mediaUrl": "https://example.com/file.pdf" }
 */
exports.sendWhatsApp = async (req, res, next) => {
  let uploadedLocalPaths = [];
  try {
    const { to, message } = req.body;
    let mediaUrls = [];

    // Parse existing mediaUrl from body (can be string or array)
    if (req.body.mediaUrl) {
      if (Array.isArray(req.body.mediaUrl)) {
        mediaUrls.push(...req.body.mediaUrl);
      } else {
        mediaUrls.push(req.body.mediaUrl);
      }
    }

    // Process uploaded files if any (multer upload.any() populates req.files)
    if (req.files && req.files.length > 0) {
      const baseUrl = await getPublicUrl(req);
      for (const file of req.files) {
        uploadedLocalPaths.push(file.path);
        console.log(`Uploading multipart file to FTP: ${file.path} -> ${file.filename}`);
        // Upload to FTP for JEA storage
        await uploadToFTP(file.path, file.filename);
        
        // Expose public HTTP/HTTPS URL for Twilio CDN access
        const publicHttpUrl = `${baseUrl}/public_uploads/${file.filename}`;
        console.log(`Generated public URL for Twilio access: ${publicHttpUrl}`);
        mediaUrls.push(publicHttpUrl);
        
        // Schedule local file deletion after 10 minutes to allow Twilio to download asynchronously
        setTimeout(() => {
          fs.unlink(file.path, (err) => {
            if (err && err.code !== 'ENOENT') {
              console.error('Failed to clean up local uploaded file:', err.message);
            }
          });
        }, 600000);
      }
    }

    if (!to) {
      const err = new Error('Field "to" is required in the request body.');
      err.statusCode = 400;
      throw err;
    }

    if (!message && mediaUrls.length === 0) {
      const err = new Error('At least one of "message", "mediaUrl" or an uploaded file must be provided.');
      err.statusCode = 400;
      throw err;
    }

    const fromWhatsApp = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';
    const targetTo = formatWhatsAppNumber(to);
    const client = getTwilioClient();

    console.log(`Sending WhatsApp message sequence to ${targetTo} from ${fromWhatsApp}...`);

    let primaryResponse = null;

    // Send the first message with text and/or the first media URL
    const primaryPayload = {
      from: fromWhatsApp,
      to: targetTo
    };
    if (message) {
      primaryPayload.body = message;
    }
    if (mediaUrls.length > 0) {
      primaryPayload.mediaUrl = [mediaUrls[0]];
    }

    primaryResponse = await client.messages.create(primaryPayload);

    // Send any additional media URLs as separate messages (Twilio limitation of 1 mediaUrl per request)
    for (let i = 1; i < mediaUrls.length; i++) {
      console.log(`Sending additional media attachment ${i + 1}/${mediaUrls.length} to ${targetTo}...`);
      await client.messages.create({
        from: fromWhatsApp,
        to: targetTo,
        mediaUrl: [mediaUrls[i]]
      });
    }

    // --- Log the sent messages into the database ---
    const cleanSessionId = targetTo.replace('whatsapp:', '').trim();
    const activeSession = await Session.findByPk(cleanSessionId, { paranoid: false });
    if (!activeSession) {
      await Session.create({
        session_id: cleanSessionId,
        status: 'OPEN',
        is_handover: false
      });
    } else {
      if (activeSession.deletedAt || activeSession.deleted_at) {
        await activeSession.restore();
      }
      if (activeSession.status !== 'OPEN') {
        await activeSession.update({ status: 'OPEN' });
      }
    }

    if (message) {
      await recordMessage(cleanSessionId, message, 'SERVER', 'TEXT');
    }
    for (const mediaUrl of mediaUrls) {
      const isPdf = mediaUrl.toLowerCase().includes('.pdf');
      await recordMessage(cleanSessionId, mediaUrl, 'SERVER', isPdf ? 'DOCUMENT' : 'IMAGE');
    }

    res.json({
      success: true,
      messageSid: primaryResponse.sid,
      status: primaryResponse.status,
      to: primaryResponse.to,
      from: primaryResponse.from,
      body: primaryResponse.body,
      mediaCount: mediaUrls.length
    });
  } catch (err) {
    // Clean up any remaining temporary files
    for (const localPath of uploadedLocalPaths) {
      if (fs.existsSync(localPath)) {
        fs.unlink(localPath, () => {});
      }
    }
    next(err);
  }
};

/**
 * Handle incoming WhatsApp webhooks from Twilio
 * POST /api/whatsapp/webhook
 * Body (urlencoded): Twilio standard payload (From, Body, MessageSid, etc.)
 */
exports.receiveWebhook = async (req, res, next) => {
  try {
    const { From, Body, MessageSid, ProfileName, SmsStatus, MessageStatus } = req.body;

    // Handle Twilio Status Callbacks directly (excluding incoming messages where SmsStatus is 'received')
    if (MessageStatus || (SmsStatus && SmsStatus !== 'received')) {
      console.log(`Received Twilio message status callback: SID=${MessageSid || req.body.SmsSid}, Status=${SmsStatus || MessageStatus}`);
      return res.sendStatus(200);
    }

    if (!From) {
      const err = new Error('Invalid Twilio payload. "From" is required.');
      err.statusCode = 400;
      throw err;
    }

    let incomingBody = Body || '';

    console.log(`\n--- Incoming WhatsApp Message ---`);
    console.log(`From: ${From}`);
    console.log(`Body: ${incomingBody}`);
    console.log(`MessageSid: ${MessageSid}`);
    console.log(`---------------------------------\n`);

    const cleanPhone = From.replace('whatsapp:', '').trim();
    const fromWhatsApp = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';
    const toWhatsApp = formatWhatsAppNumber(cleanPhone);
    const { MessagingResponse } = twilio.twiml;
    const twiml = new MessagingResponse();

    // 1. Check if user exists in the database
    const customer = await Customer.findOne({
      where: { phone: cleanPhone },
      include: [{ model: User, as: 'user' }]
    });

    // 2. Retrieve or create an active Session, handling primary key uniqueness and soft-deletes
    let session = await Session.findByPk(cleanPhone, { paranoid: false });
    if (!session) {
      session = await Session.create({
        session_id: cleanPhone,
        status: 'OPEN',
        is_handover: false
      });
    } else {
      if (session.deletedAt || session.deleted_at) {
        await session.restore();
      }
      if (session.status !== 'OPEN' || session.is_handover) {
        await session.update({ status: 'OPEN', is_handover: false });
      }
    }

    // 3. Process the stateful chatbot dialog and language detection
    let state = sessionStates.get(cleanPhone);
    let normalizedBody = incomingBody.trim().toLowerCase();

    // Detect language: if input contains Arabic, set language to 'ar', else retain previous language or default to 'en'
    const isArabicInput = /[\u0600-\u06FF]/.test(incomingBody);
    let userLang = 'en';
    if (isArabicInput) {
      userLang = 'ar';
    } else if (state?.lang) {
      userLang = state.lang;
    }

    // Resolve display name: WhatsApp profile name → DB name → generic fallback
    const whatsappName = ProfileName ? ProfileName.trim() : null;
    const dbName = customer?.user?.name && customer.user.name !== 'John Doe' ? customer.user.name.trim() : null;
    const displayName = whatsappName || dbName || (userLang === 'ar' ? 'حضرة المهندس' : 'there');

    if (!customer) {
      const reply = getTranslation(userLang, 'contactSupport');
      twiml.message(reply);
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // Check if in error retry state
    if (state?.step === 'AWAITING_ERROR_RETRY') {
      if (normalizedBody === '1') {
        // Restore previous state
        state = state.previousState || { lang: userLang };
        sessionStates.set(cleanPhone, state);
        const retryText = userLang === 'ar'
          ? `تم استعادة جلستك السابقة بنجاح. يرجى إعادة إرسال طلبك الأخير للمتابعة:`
          : `Your previous session has been restored successfully. Please re-send your last request to proceed:`;
        
        await recordMessage(session.session_id, retryText, 'SERVER', 'TEXT');
        twiml.message(retryText);
        res.type('text/xml');
        return res.send(twiml.toString());
      } else {
        // Force returning to main menu by resetting state and input
        sessionStates.delete(cleanPhone);
        incomingBody = 'hello';
        normalizedBody = 'hello';
        state = null;
      }
    }

    // Process attachments
    let mediaAttachments = null;
    try {
      mediaAttachments = await processIncomingMedia(req.body);
    } catch (mediaErr) {
      console.error('Incoming media processing failed:', mediaErr.message);
      const errorMsg = userLang === 'ar'
        ? `❌ صيغة الملف غير مدعومة. يسمح فقط بإرسال الصور أو ملفات PDF لحماية الأنظمة.`
        : `❌ Unsupported file format. Only images and PDFs are allowed for system security.`;
      
      await recordMessage(session.session_id, incomingBody || '(Media)', cleanPhone, 'TEXT');
      await recordMessage(session.session_id, errorMsg, 'SERVER', 'TEXT');

      twiml.message(errorMsg);
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // Log user's message
    if (mediaAttachments && mediaAttachments.length > 0) {
      for (const attachment of mediaAttachments) {
        await recordMessage(session.session_id, attachment.url, cleanPhone, attachment.type);
      }
    }
    if (incomingBody.trim().length > 0 || !mediaAttachments) {
      await recordMessage(session.session_id, incomingBody, cleanPhone, 'TEXT');
    }

    // Support keywords
    const supportKeywords = [
      'اريد التواصل مع خدمة العملاء',
      'تواصل مع خدمة العملاء',
      'تواصل',
      'دعم',
      'عملاء',
      'human',
      'support',
      'chat with support'
    ];

    // Trigger explicit customer support hotlines list
    if (supportKeywords.includes(normalizedBody)) {
      const categories = await ServiceCategory.findAll({ where: { status: 'ACTIVE' } });
      const categoryList = categories.map((c, i) => `${i + 1}. ${c.service_name}: ${c.contact_number || '+962 6 500 0000'}`).join('\n');
      
      const responseText = userLang === 'ar'
        ? `يرجى التواصل مباشرة مع الأقسام الإدارية عبر الأرقام التالية:\n${categoryList}`
        : `Please contact the administrative departments directly using the following numbers:\n${categoryList}`;

      sessionStates.delete(cleanPhone);
      await session.update({ status: 'CLOSED' });
      await recordMessage(session.session_id, responseText, 'SERVER', 'TEXT');

      twiml.message(responseText);
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // 4. Rating Steps
    
    // AWAITING_RATING step
    if (state?.step === 'AWAITING_RATING') {
      const ratingVal = Number.parseInt(incomingBody.trim(), 10);
      if (Number.isNaN(ratingVal) || ratingVal < 1 || ratingVal > 5) {
        const reply = getTranslation(userLang, 'ratingInvalid');
        await recordMessage(session.session_id, reply, 'SERVER', 'TEXT');
        twiml.message(reply);
        res.type('text/xml');
        return res.send(twiml.toString());
      }

      sessionStates.set(cleanPhone, {
        step: 'AWAITING_RATING_COMMENT',
        ticketId: state.ticketId,
        ratingValue: ratingVal,
        lang: userLang
      });

      const reply = getTranslation(userLang, 'commentPrompt');
      await recordMessage(session.session_id, reply, 'SERVER', 'TEXT');
      twiml.message(reply);
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // AWAITING_RATING_COMMENT step
    if (state?.step === 'AWAITING_RATING_COMMENT') {
      const comments = (incomingBody.trim().toLowerCase() === 'none' || incomingBody.trim() === 'لا') 
        ? null 
        : incomingBody.trim();

      await Rating.create({
        rate_id: 'rate_' + crypto.randomUUID(),
        rate_value: state.ratingValue,
        comments: comments,
        user_id: customer.member_id,
        ticket_id: state.ticketId,
        status: 'ACTIVE'
      });

      const reply = getTranslation(userLang, 'ratingSuccess', { ticketId: state.ticketId, rating: state.ratingValue });
      sessionStates.delete(cleanPhone);
      await session.update({ status: 'CLOSED' });

      await recordMessage(session.session_id, reply, 'SERVER', 'TEXT');
      twiml.message(reply);
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // Default conversational menu keywords (English & Arabic greetings)
    const resetKeywords = [
      'hello', 'hi', 'hey', 'start', 'restart', 'menu',
      'مرحبا', 'مرحباً', 'السلام عليكم', 'سلام', 'هلا', 'أهلا', 'اهلا', 'اهلاً', 'أهلاً'
    ];
    if (resetKeywords.some(kw => normalizedBody === kw.toLowerCase() || incomingBody.trim() === kw)) {
      const categories = await ServiceCategory.findAll({ where: { status: 'ACTIVE' } });

      if (categories.length === 0) {
        const reply = getTranslation(userLang, 'welcomeNoCategories', { name: displayName });
        twiml.message(reply);
        res.type('text/xml');
        return res.send(twiml.toString());
      }

      sessionStates.set(cleanPhone, { step: 'AWAITING_CATEGORY', categories, lang: userLang });

      // Use Twilio Content Template (List Picker) if configured, otherwise fall back to plain text
      const greetingSid = userLang === 'ar'
        ? process.env.GREETING_TEMPLATE_SID_AR
        : process.env.GREETING_TEMPLATE_SID_EN;

      if (greetingSid) {
        try {
          const client = getTwilioClient();
          const msgResult = await client.messages.create({
            from: fromWhatsApp,
            to: toWhatsApp,
            contentSid: greetingSid
          });
          console.log(`Greeting Content Template sent. SID=${msgResult.sid}`);
          await recordMessage(session.session_id, `[List Picker Template: ${greetingSid}]`, 'SERVER', 'TEXT');
          res.type('text/xml');
          return res.send(twiml.toString());
        } catch (templateErr) {
          console.error('Failed to send greeting Content Template, falling back to plain text:', templateErr.message);
        }
      }

      // Plain text fallback
      const categoryList = categories.map((c, i) => `${i + 1}. ${c.service_name}`).join('\n');
      const responseText = getTranslation(userLang, 'welcomePrompt', { name: displayName, list: categoryList });

      await recordMessage(session.session_id, responseText, 'SERVER', 'TEXT');

      twiml.message(responseText);
      res.type('text/xml');
      return res.send(twiml.toString());
    }


    // AWAITING_CATEGORY step
    if (state?.step === 'AWAITING_CATEGORY') {
      const selection = Number.parseInt(incomingBody.trim(), 10);
      let selectedCategory = null;

      if (!Number.isNaN(selection) && selection > 0 && selection <= state.categories.length) {
        selectedCategory = state.categories[selection - 1];
      } else {
        // Twilio sends the ListId (service_id) as the Body for interactive list replies,
        // but users may also type the display name — match both.
        const normalizedInput = incomingBody.trim().toLowerCase();
        selectedCategory = state.categories.find(
          c => c.service_name.toLowerCase() === normalizedInput
            || c.service_id.toLowerCase() === normalizedInput
        );
      }

      if (!selectedCategory) {
        const reply = getTranslation(userLang, 'invalidSelectionCategory');
        await recordMessage(session.session_id, reply, 'SERVER', 'TEXT');

        twiml.message(reply);
        res.type('text/xml');
        return res.send(twiml.toString());
      }

      const services = await QA.findAll({
        where: { service_category_id: selectedCategory.service_id, status: 'ACTIVE' }
      });

      const filteredServices = services.filter(service => {
        if (service.content.includes('[VIP]') && customer.role !== 'VIP') {
          return false;
        }
        if (service.content.includes('[MEMBER]') && customer.role === 'GUEST') {
          return false;
        }
        return true;
      });

      if (filteredServices.length === 0) {
        const reply = getTranslation(userLang, 'noServicesAvailable', { category: selectedCategory.service_name });
        sessionStates.delete(cleanPhone);
        await recordMessage(session.session_id, reply, 'SERVER', 'TEXT');

        twiml.message(reply);
        res.type('text/xml');
        return res.send(twiml.toString());
      }

      // For the Health Insurance category — send Quick Reply template with service buttons
      if (selectedCategory.service_id === 'health_insurance') {
        const healthInsuranceSid = userLang === 'ar'
          ? process.env.HEALTH_INSURANCE_TEMPLATE_SID_AR
          : process.env.HEALTH_INSURANCE_TEMPLATE_SID_EN;

        if (healthInsuranceSid) {
          try {
            const client = getTwilioClient();
            const msgResult = await client.messages.create({
              from: fromWhatsApp,
              to: toWhatsApp,
              contentSid: healthInsuranceSid
            });
            console.log(`Health Insurance Quick Reply Template sent. SID=${msgResult.sid}`);
            await recordMessage(session.session_id, `[Quick Reply Template: ${healthInsuranceSid}]`, 'SERVER', 'TEXT');

            sessionStates.set(cleanPhone, {
              step: 'AWAITING_SERVICE',
              services: filteredServices,
              selectedCategory,
              lang: userLang
            });

            res.type('text/xml');
            return res.send(twiml.toString());
          } catch (templateErr) {
            console.error('Failed to send Health Insurance Quick Reply template, falling back to plain text:', templateErr.message);
          }
        }
      }


      // Plain text fallback for other categories

      const serviceList = filteredServices.map((s, i) => `${i + 1}. Request service: ${s.id}`).join('\n');
      const responseText = getTranslation(userLang, 'selectServicePrompt', { category: selectedCategory.service_name, list: serviceList });

      sessionStates.set(cleanPhone, {
        step: 'AWAITING_SERVICE',
        services: filteredServices,
        selectedCategory,
        lang: userLang
      });
      await recordMessage(session.session_id, responseText, 'SERVER', 'TEXT');

      twiml.message(responseText);
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // AWAITING_SERVICE step
    if (state?.step === 'AWAITING_SERVICE') {
      const trimmedBody = incomingBody.trim();

      // Handle "Main Menu" button reply — go back to greeting
      if (trimmedBody === 'main_menu' || trimmedBody === 'القائمة الرئيسية' || trimmedBody === 'Main Menu') {
        sessionStates.delete(cleanPhone);
        const categories = await ServiceCategory.findAll({ where: { status: 'ACTIVE' } });
        const greetingSid = userLang === 'ar'
          ? process.env.GREETING_TEMPLATE_SID_AR
          : process.env.GREETING_TEMPLATE_SID_EN;

        if (greetingSid) {
          try {
            const client = getTwilioClient();
            const msgResult = await client.messages.create({
              from: fromWhatsApp,
              to: toWhatsApp,
              contentSid: greetingSid
            });
            console.log(`Greeting template sent after main_menu. SID=${msgResult.sid}`);
            await recordMessage(session.session_id, `[List Picker Template: ${greetingSid}]`, 'SERVER', 'TEXT');
            sessionStates.set(cleanPhone, { step: 'AWAITING_CATEGORY', categories, lang: userLang });
            res.type('text/xml');
            return res.send(twiml.toString());
          } catch (err) {
            console.error('Failed to send greeting template:', err.message);
          }
        }
        // Plain text fallback for main menu
        const categoryList = categories.map((c, i) => `${i + 1}. ${c.service_name}`).join('\n');
        const welcomeText = getTranslation(userLang, 'welcomePrompt', { name: displayName, list: categoryList });
        sessionStates.set(cleanPhone, { step: 'AWAITING_CATEGORY', categories, lang: userLang });
        await recordMessage(session.session_id, welcomeText, 'SERVER', 'TEXT');
        twiml.message(welcomeText);
        res.type('text/xml');
        return res.send(twiml.toString());
      }

      // Handle "View Insurance Card" button — call JEA Health Insurance API
      if (trimmedBody === 'view_health_card' || trimmedBody === 'عرض بطاقة التأمين' || trimmedBody === 'View Insurance Card') {
        try {
          // Get engineer key: from customer record or use default for testing
          const engKey = customer?.eng_key || process.env.DEFAULT_ENG_KEY || '100006';

          const apiUrl = `http://188.247.92.205:2233/api/MobService_Health/GET_Cards_health?p_fincrd_srctyp_val=2&p_eng_key=${engKey}`;
          const http = require('node:http');

          const apiResponse = await new Promise((resolve, reject) => {
            const req = http.get(apiUrl, {
              headers: {
                'Authorization': `Bearer ${process.env.JEA_HEALTH_API_TOKEN || 'F2D544A52558B6BAC62C313FCCE48'}`
              }
            }, (apiRes) => {
              let data = '';
              apiRes.on('data', chunk => { data += chunk; });
              apiRes.on('end', () => {
                try {
                  resolve({ status: apiRes.statusCode, body: JSON.parse(data) });
                } catch {
                  resolve({ status: apiRes.statusCode, body: data });
                }
              });
            });

            req.on('error', (err) => {
              console.error(`[JEA API] Connection error fetching cards for key ${engKey}:`, err.message);
              reject(err);
            });

            // Configure request timeout (8 seconds) to prevent hanging Twilio callback
            req.setTimeout(8000, () => {
              console.warn(`[JEA API] Request timed out after 8000ms for key ${engKey}`);
              req.destroy(new Error('Outsource API connection timed out'));
            });
          });

          if (apiResponse.status === 200 && apiResponse.body?.Table?.length > 0) {
            const cards = apiResponse.body.Table;

            // Format each card's info as a readable WhatsApp message
            let reply = userLang === 'ar'
              ? `💳 *بطاقات التأمين الصحي*\n━━━━━━━━━━━━━━━━━━━━\n`
              : `💳 *Health Insurance Cards*\n━━━━━━━━━━━━━━━━━━━━\n`;

            cards.forEach((card, index) => {
              if (userLang === 'ar') {
                reply += `\n*بطاقة ${index + 1}:*\n`;
                reply += `👤 الاسم: ${card.ENG_NAME || '-'}\n`;
                if (card.BENNAME?.trim()) reply += `👥 المستفيد: ${card.BENNAME.trim()}\n`;
                reply += `🔢 رقم التأمين: ${card.INSURNO || '-'}\n`;
                reply += `📋 البرنامج: ${card.TYPE_MM || '-'}\n`;
                reply += `🏥 التغطية: ${card.GRADE || '-'}\n`;
                reply += `💰 نسبة التحمل: ${card.OUT_PERC || '-'}\n`;
                reply += `📅 تاريخ الانضمام: ${card.JOINE_DATE || '-'}\n`;
                reply += `⏰ تاريخ الانتهاء: ${card.END_DATE || '-'}\n`;
                reply += `━━━━━━━━━━━━━━━━━━━━\n`;
              } else {
                reply += `\n*Card ${index + 1}:*\n`;
                reply += `👤 Name: ${card.ENG_NAME || '-'}\n`;
                if (card.BENNAME?.trim()) reply += `👥 Beneficiary: ${card.BENNAME.trim()}\n`;
                reply += `🔢 Insurance No: ${card.INSURNO || '-'}\n`;
                reply += `📋 Program: ${card.TYPE_MM || '-'}\n`;
                reply += `🏥 Coverage: ${card.GRADE || '-'}\n`;
                reply += `💰 Co-pay: ${card.OUT_PERC || '-'}\n`;
                reply += `📅 Join Date: ${card.JOINE_DATE || '-'}\n`;
                reply += `⏰ End Date: ${card.END_DATE || '-'}\n`;
                reply += `━━━━━━━━━━━━━━━━━━━━\n`;
              }
            });

            sessionStates.delete(cleanPhone);
            await recordMessage(session.session_id, reply, 'SERVER', 'TEXT');
            twiml.message(reply);
            res.type('text/xml');
            return res.send(twiml.toString());
          } else {
            const noDataReply = userLang === 'ar'
              ? '⚠️ لم يتم العثور على بطاقات تأمين صحي مرتبطة بحسابك. يرجى التواصل مع النقابة للمساعدة.'
              : '⚠️ No health insurance cards found for your account. Please contact JEA for assistance.';
            await recordMessage(session.session_id, noDataReply, 'SERVER', 'TEXT');
            twiml.message(noDataReply);
            res.type('text/xml');
            return res.send(twiml.toString());
          }
        } catch (apiErr) {
          console.error('Health Insurance API error:', apiErr.message);
          const errorReply = userLang === 'ar'
            ? '❌ حدث خطأ أثناء استرجاع بيانات التأمين. يرجى المحاولة مجدداً لاحقاً.'
            : '❌ An error occurred while retrieving insurance data. Please try again later.';
          await recordMessage(session.session_id, errorReply, 'SERVER', 'TEXT');
          twiml.message(errorReply);
          res.type('text/xml');
          return res.send(twiml.toString());
        }
      }


      // Numeric or ID selection (plain text fallback)
      const selection = Number.parseInt(trimmedBody, 10);
      let selectedService = null;

      if (!Number.isNaN(selection) && selection > 0 && selection <= state.services.length) {
        selectedService = state.services[selection - 1];
      } else {
        selectedService = state.services.find(
          s => s.id.toLowerCase() === trimmedBody.toLowerCase()
        );
      }

      if (!selectedService) {
        const reply = getTranslation(userLang, 'invalidSelectionService');
        await recordMessage(session.session_id, reply, 'SERVER', 'TEXT');

        twiml.message(reply);
        res.type('text/xml');
        return res.send(twiml.toString());
      }

      const templatePrompt = getTranslation(userLang, 'templatePrompt', { service: selectedService.id, content: selectedService.content });

      sessionStates.set(cleanPhone, {
        step: 'AWAITING_TEMPLATE',
        selectedCategory: state.selectedCategory,
        selectedService,
        lang: userLang
      });
      await recordMessage(session.session_id, templatePrompt, 'SERVER', 'TEXT');

      twiml.message(templatePrompt);
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // AWAITING_TICKET_CONFIRM step
    if (state?.step === 'AWAITING_TICKET_CONFIRM') {
      const userInput = incomingBody.trim().toLowerCase();
      
      const isYes = userInput === '1' 
        || userInput === 'yes' 
        || userInput === 'نعم' 
        || userInput === 'y' 
        || userInput === 'ok'
        || userInput.includes('تكت')
        || userInput.includes('تذكر')
        || userInput.includes('افتح')
        || userInput.includes('open')
        || userInput.includes('ticket');

      if (isYes) {
        const ticketId = 'tkt_' + crypto.randomUUID();
        const detectedRegion = detectRegionByPhone(cleanPhone);
        
        const ticketTitle = userLang === 'ar'
          ? `استفسار ذكاء اصطناعي (غير مجاب عليه) - المهندس: ${displayName}`
          : `AI Q&A Inquiry (Unanswered) - Eng: ${displayName}`;

        const ticketContent = userLang === 'ar'
          ? `[السؤال]: ${state.originalQuestion}\n[درجة الثقة]: ${Math.round((state.score || 0) * 100)}%\n[المنطقة]: ${detectedRegion}`
          : `[Question]: ${state.originalQuestion}\n[Confidence]: ${Math.round((state.score || 0) * 100)}%\n[Region]: ${detectedRegion}`;

        await Ticket.create({
          ticket_id: ticketId,
          ticket_priority: 'MEDIUM',
          title: ticketTitle,
          content: ticketContent,
          ai_confedance: state.score || 0.0,
          user_id: customer.member_id,
          status: 'OPEN'
        });

        sessionStates.set(cleanPhone, {
          step: 'AWAITING_RATING',
          ticketId,
          lang: userLang
        });

        const reply = getTranslation(userLang, 'ratingPrompt');
        await recordMessage(session.session_id, reply, 'SERVER', 'TEXT');

        twiml.message(reply);
        res.type('text/xml');
        return res.send(twiml.toString());
      } else {
        sessionStates.delete(cleanPhone);
        await session.update({ status: 'CLOSED' });

        const reply = getTranslation(userLang, 'ticketCancel');
        await recordMessage(session.session_id, reply, 'SERVER', 'TEXT');

        twiml.message(reply);
        res.type('text/xml');
        return res.send(twiml.toString());
      }
    }

    // AWAITING_TEMPLATE step
    if (state?.step === 'AWAITING_TEMPLATE') {
      const userInput = incomingBody.trim();
      const isValid = userInput.includes('[') && userInput.includes(']') && userInput.includes(':');

      if (isValid) {
        const ticketId = 'tkt_' + crypto.randomUUID();
        const detectedRegion = detectRegionByPhone(cleanPhone);

        let finalContent = userInput;
        if (mediaAttachments && mediaAttachments.length > 0) {
          finalContent += "\n\n[Attachments]:\n" + mediaAttachments.map(m => m.url).join('\n');
        }

        await Ticket.create({
          ticket_id: ticketId,
          ticket_priority: 'MEDIUM',
          title: `${state.selectedCategory.service_name} Request (${state.selectedService.id}) - Region: ${detectedRegion}`,
          content: finalContent,
          ai_confedance: 0.95,
          user_id: customer.member_id,
          status: 'OPEN'
        });

        sessionStates.set(cleanPhone, {
          step: 'AWAITING_RATING',
          ticketId,
          lang: userLang
        });

        const reply = getTranslation(userLang, 'ratingPrompt');
        await recordMessage(session.session_id, reply, 'SERVER', 'TEXT');

        twiml.message(reply);
        res.type('text/xml');
        return res.send(twiml.toString());
      } else {
        const reply = getTranslation(userLang, 'requestFailed');
        await recordMessage(session.session_id, reply, 'SERVER', 'TEXT');

        twiml.message(reply);
        res.type('text/xml');
        return res.send(twiml.toString());
      }
    }

    // ========================================================
    // AI Q&A Engine / Natural Language Search
    // ========================================================
    try {
      const qaResult = await getAnswer(incomingBody, userLang);

      if (qaResult.canAnswer) {
        // Case 1: High confidence (>= 20%) -> Answer directly
        sessionStates.delete(cleanPhone);
        await session.update({ status: 'CLOSED' });
        await recordMessage(session.session_id, qaResult.answer, 'SERVER', 'TEXT');
        
        twiml.message(qaResult.answer);
        res.type('text/xml');
        return res.send(twiml.toString());
      } else {
        // Case 2: Low confidence (< 20%) -> Create ticket IMMEDIATELY (no restrictions)
        const ticketId = 'tkt_' + crypto.randomUUID();
        const detectedRegion = detectRegionByPhone(cleanPhone);
        
        const ticketTitle = userLang === 'ar'
          ? `استفسار ذكاء اصطناعي (غير مجاب عليه) - المهندس: ${displayName}`
          : `AI Q&A Inquiry (Unanswered) - Eng: ${displayName}`;

        const ticketContent = userLang === 'ar'
          ? `[السؤال]: ${incomingBody}\n[درجة الثقة]: ${Math.round((qaResult.score || 0) * 100)}%\n[المنطقة]: ${detectedRegion}`
          : `[Question]: ${incomingBody}\n[Confidence]: ${Math.round((qaResult.score || 0) * 100)}%\n[Region]: ${detectedRegion}`;

        await Ticket.create({
          ticket_id: ticketId,
          ticket_priority: 'MEDIUM',
          title: ticketTitle,
          content: ticketContent,
          ai_confedance: qaResult.score || 0.0,
          user_id: customer.member_id,
          status: 'OPEN'
        });

        sessionStates.set(cleanPhone, {
          step: 'AWAITING_RATING',
          ticketId,
          lang: userLang
        });

        const successText = userLang === 'ar'
          ? `شكراً لك! تم تسجيل طلبك بنجاح وفتح تذكرة دعم برقم (${ticketId}) لمتابعة استفسارك مع القسم المختص.\n\nيرجى تقييم جودة الخدمة من 1 إلى 5 درجات:`
          : `Thank you! Your request has been successfully registered and a support ticket (${ticketId}) has been opened to follow up with our team.\n\nPlease rate our service quality from 1 to 5 stars:`;

        await recordMessage(session.session_id, successText, 'SERVER', 'TEXT');
        twiml.message(successText);
        res.type('text/xml');
        return res.send(twiml.toString());
      }
    } catch (qaErr) {
      console.error('QA Engine search failed, using default support info:', qaErr.message);
      const categories = await ServiceCategory.findAll({ where: { status: 'ACTIVE' } });
      const categoryList = categories.map((c, i) => `${i + 1}. ${c.service_name}: ${c.contact_number || '+962 6 500 0000'}`).join('\n');
      
      const replyText = userLang === 'ar'
        ? `عذراً، لم أتمكن من العثور على إجابة لاستفسارك.\n\nيرجى التواصل مباشرة مع أحد أقسامنا عبر الأرقام التالية لمساعدتك بشكل أفضل:\n${categoryList}`
        : `Sorry, I couldn't find an answer to your query.\n\nPlease contact our departments directly using these numbers to assist you:\n${categoryList}`;

      sessionStates.delete(cleanPhone);
      await session.update({ status: 'CLOSED' });
      await recordMessage(session.session_id, replyText, 'SERVER', 'TEXT');

      twiml.message(replyText);
      res.type('text/xml');
      return res.send(twiml.toString());
    }
  } catch (err) {
    console.error('Webhook error occurred:', err);
    try {
      const { MessagingResponse } = twilio.twiml;
      const twiml = new MessagingResponse();
      
      const safeLang = (typeof userLang !== 'undefined') ? userLang : 'en';
      let safePhone = 'unknown';
      if (typeof cleanPhone !== 'undefined') {
        safePhone = cleanPhone;
      } else if (req.body?.From) {
        safePhone = req.body.From.replace('whatsapp:', '').trim();
      }
      const safeState = (typeof state !== 'undefined') ? state : null;
      
      const errorMsg = safeLang === 'ar'
        ? `عذراً، حدث خلل تقني أثناء معالجة طلبك أو جلب البيانات. يرجى الاختيار:\n1. إعادة المحاولة\n2. العودة للقائمة الرئيسية`
        : `Sorry, a technical error occurred while processing your request or retrieving data. Please choose:\n1. Retry\n2. Return to Main Menu`;
      
      if (safePhone !== 'unknown') {
        sessionStates.set(safePhone, {
          step: 'AWAITING_ERROR_RETRY',
          previousState: safeState,
          lang: safeLang
        });
      }

      const safeSessionId = (typeof session !== 'undefined' && session) ? session.session_id : safePhone;
      await recordMessage(safeSessionId, errorMsg, 'SERVER', 'TEXT');
      
      twiml.message(errorMsg);
      res.type('text/xml');
      return res.send(twiml.toString());
    } catch (innerErr) {
      console.error('Failed to send error message response:', innerErr);
      next(err);
    }
  }
};
