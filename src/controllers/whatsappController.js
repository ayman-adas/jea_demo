const twilio = require('twilio');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { uploadToFTP } = require('../config/ftp');
const { Customer, User, Session, Message, ServiceCategory, QA, Ticket, Notification, EmployeeServiceCategory, Rating } = require('../models');
const { Op } = require('sequelize');
const { getTranslation } = require('../config/localization');
const { getAnswer } = require('../services/qaEngine');

const normalizePhone = (input) => {
  if (!input) return '';
  let cleaned = input.replace(/\s+/g, '').replace(/[-()]/g, '');
  if (cleaned.startsWith('00962')) {
    cleaned = '+962' + cleaned.slice(5);
  } else if (cleaned.startsWith('962')) {
    cleaned = '+' + cleaned;
  } else if (cleaned.startsWith('07') && cleaned.length === 10) {
    cleaned = '+962' + cleaned.slice(1);
  }
  return cleaned;
};

const parseArabicDigits = (str) => {
  if (!str) return '';
  return str.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
};


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

// Helper to parse WhatsApp Flow submission payloads (e.g. customer_satisfaction_ar)
const parseFlowSubmission = (reqBody) => {
  let rawJson = reqBody.FlowData || reqBody.ButtonPayload || reqBody.InteractiveData || reqBody.StructuredData;
  let parsed = null;

  if (rawJson) {
    if (typeof rawJson === 'string') {
      try { parsed = JSON.parse(rawJson); } catch (e) { parsed = null; }
    } else if (typeof rawJson === 'object') {
      parsed = rawJson;
    }
  }

  if (!parsed && reqBody.Body && typeof reqBody.Body === 'string' && reqBody.Body.trim().startsWith('{') && reqBody.Body.trim().endsWith('}')) {
    try { parsed = JSON.parse(reqBody.Body.trim()); } catch (e) { parsed = null; }
  }

  if (!parsed) return null;

  let rateValue = null;
  let comments = null;
  const dataObj = parsed.data || parsed;

  for (const [key, val] of Object.entries(dataObj)) {
    if (val === null || val === undefined) continue;
    const strVal = String(val).trim();
    if (!strVal) continue;

    const keyLower = key.toLowerCase();

    if (keyLower.includes('comment') || keyLower.includes('reason') || keyLower.includes('feedback') || keyLower.includes('note') || keyLower.includes('question_2') || keyLower.includes('ملاحظ') || keyLower.includes('سبب')) {
      comments = strVal;
      continue;
    }

    if (rateValue === null) {
      if (/^[1-5](\.0)?$/.test(strVal)) {
        rateValue = Number.parseFloat(strVal);
      } else if (/^[1-5]$/.test(key)) {
        rateValue = Number.parseFloat(key);
      } else if (typeof val === 'string' && (strVal.includes('ممتاز') || strVal.includes('جيد') || strVal.includes('مقبول') || strVal.includes('ضعيف'))) {
        if (strVal.includes('5') || strVal.includes('ممتاز')) rateValue = 5;
        else if (strVal.includes('4') || strVal.includes('جيد جداً')) rateValue = 4;
        else if (strVal.includes('3') || strVal.includes('جيد')) rateValue = 3;
        else if (strVal.includes('2') || strVal.includes('مقبول')) rateValue = 2;
        else if (strVal.includes('1') || strVal.includes('ضعيف')) rateValue = 1;
      }
    } else if (!comments && typeof val === 'string' && !/^[1-5]$/.test(strVal)) {
      comments = strVal;
    }
  }

  if (!rateValue && (parsed.rate_value || parsed.rating || parsed.rate)) {
    const r = parsed.rate_value || parsed.rating || parsed.rate;
    if (!Number.isNaN(Number.parseFloat(r))) {
      rateValue = Number.parseFloat(r);
    }
  }

  if (!comments && (parsed.comments || parsed.comment || parsed.feedback || parsed.reason)) {
    comments = parsed.comments || parsed.comment || parsed.feedback || parsed.reason;
  }

  if (rateValue !== null) {
    return { rate_value: rateValue, comments: comments || null, raw: parsed };
  }

  return null;
};

// Helper to send Customer Satisfaction Flow Template (customer_satisfaction_ar: HX0827ed175724bb0ee0e81b0591bf92de)
const sendCustomerSatisfactionFlow = async ({
  fromWhatsApp,
  toWhatsApp,
  cleanPhone,
  session,
  ticketId,
  userLang,
  twiml,
  res,
  introMessage,
  delayMs = process.env.NODE_ENV === 'test' ? 0 : Number.parseInt(process.env.RATING_FLOW_DELAY_MS || '3000', 10)
}) => {
  const flowSid = process.env.CUSTOMER_SATISFACTION_TEMPLATE_SID_AR || 'HX0827ed175724bb0ee0e81b0591bf92de';

  sessionStates.set(cleanPhone, {
    step: 'AWAITING_RATING',
    ticketId,
    lang: userLang
  });

  if (introMessage) {
    twiml.message(introMessage);
    await recordMessage(session.session_id, introMessage, 'SERVER', 'TEXT');
  }

  if (flowSid) {
    if (delayMs > 0) {
      console.log(`Scheduling Customer Satisfaction Flow Template dispatch in ${delayMs}ms...`);
      res.type('text/xml');
      res.send(twiml.toString());

      setTimeout(async () => {
        try {
          const client = getTwilioClient();
          const msgResult = await client.messages.create({
            from: fromWhatsApp,
            to: toWhatsApp,
            contentSid: flowSid
          });
          console.log(`Customer Satisfaction Flow Template sent after ${delayMs}ms timer. SID=${msgResult.sid}`);
          await recordMessage(session.session_id, `[Customer Satisfaction Flow: ${flowSid}]`, 'SERVER', 'TEXT');
        } catch (flowErr) {
          console.error('Failed to send timed Customer Satisfaction Flow template:', flowErr.message);
        }
      }, delayMs);

      return;
    }

    try {
      const client = getTwilioClient();
      const msgResult = await client.messages.create({
        from: fromWhatsApp,
        to: toWhatsApp,
        contentSid: flowSid
      });
      console.log(`Customer Satisfaction Flow Template sent immediately. SID=${msgResult.sid}`);
      await recordMessage(session.session_id, `[Customer Satisfaction Flow: ${flowSid}]`, 'SERVER', 'TEXT');
      res.type('text/xml');
      return res.send(twiml.toString());
    } catch (flowErr) {
      console.error('Failed to send Customer Satisfaction Flow template, falling back to text rating prompt:', flowErr.message);
    }
  }

  // Fallback to text rating prompt
  const reply = introMessage
    ? `${introMessage}\n\n${getTranslation(userLang, 'ratingPrompt')}`
    : getTranslation(userLang, 'ratingPrompt');

  await recordMessage(session.session_id, reply, 'SERVER', 'TEXT');
  twiml.message(reply);
  res.type('text/xml');
  return res.send(twiml.toString());
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
      // Reopen closed sessions and clear handover when user restarts a new session
      if (session.status !== 'OPEN') {
        await session.update({ status: 'OPEN', is_handover: false });
      }
    }

    // 2b. Auto-exit handover if user interacts with bot menu buttons/lists.
    //     ButtonPayload/ListId signals the user chose from a bot-provided interactive menu,
    //     meaning they want the bot — not a human agent — to handle their request.
    const { ButtonPayload, ListId } = req.body;
    if (session.is_handover === true && (ButtonPayload || ListId)) {
      await session.update({ is_handover: false });
      sessionStates.delete(cleanPhone);
      console.log(`[HANDOVER] Session ${cleanPhone} auto-exited handover via bot button/list interaction.`);
    }

    // 2c. HANDOVER MODE: if a human agent has taken over this session, silently log the
    //     incoming message and return without any bot reply, so the agent can reply manually.
    if (session.is_handover === true) {
      await recordMessage(session.session_id, incomingBody || '[media]', cleanPhone, 'TEXT');
      console.log(`[HANDOVER] Session ${cleanPhone} is in handover mode — bot suppressed, message logged.`);
      res.type('text/xml');
      return res.send(twiml.toString()); // empty TwiML = no bot reply
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

    // Check for WhatsApp Flow submission callback (customer_satisfaction_ar)
    const flowResult = parseFlowSubmission(req.body);
    if (flowResult) {
      console.log(`Received WhatsApp Flow rating submission: rate_value=${flowResult.rate_value}, comments=${flowResult.comments}`);

      const activeTicketId = state?.ticketId || null;
      const ratingId = 'rate_' + crypto.randomUUID();

      await Rating.create({
        rate_id: ratingId,
        rate_value: flowResult.rate_value,
        comments: flowResult.comments,
        user_id: customer.member_id,
        ticket_id: activeTicketId,
        status: 'ACTIVE'
      });

      const reply = userLang === 'ar'
        ? `شكراً لتعاملك معنا. تم تسجيل تقييمك بنجاح!`
        : `Thank you for contacting us. Your rating has been recorded successfully!`;

      sessionStates.delete(cleanPhone);
      await session.update({ status: 'CLOSED' });

      await recordMessage(session.session_id, reply, 'SERVER', 'TEXT');
      twiml.message(reply);
      res.type('text/xml');
      return res.send(twiml.toString());
    }


    // AWAITING_SUPPORT_DEPARTMENT step
    if (state?.step === 'AWAITING_SUPPORT_DEPARTMENT') {
      const selection = (req.body.ListId || req.body.ButtonPayload || incomingBody).trim();
      let departmentName = '';

      if (selection === 'handoff_health' || selection === '1' || selection.includes('تأمين') || selection.includes('health')) {
        departmentName = userLang === 'ar' ? 'قسم التأمين الصحي' : 'Health Insurance Department';
      } else if (selection === 'handoff_retirement' || selection === '2' || selection.includes('تقاعد') || selection.includes('retirement')) {
        departmentName = userLang === 'ar' ? 'قسم صندوق التقاعد' : 'Retirement Fund Department';
      } else if (selection === 'handoff_general' || selection === '3' || selection.includes('أعضاء') || selection.includes('اعضاء') || selection.includes('member')) {
        departmentName = userLang === 'ar' ? 'قسم خدمات الأعضاء' : 'Member Services Department';
      } else {
        departmentName = userLang === 'ar' ? 'قسم خدمة العملاء' : 'Customer Support Department';
      }

      await session.update({ is_handover: true, status: 'OPEN' });

      const ticketId = 'tkt_' + crypto.randomUUID();
      await Ticket.create({
        ticket_id: ticketId,
        ticket_priority: 'HIGH',
        title: `Customer Support Handover Request - ${departmentName}`,
        content: `[User Handover Request]\n[Department]: ${departmentName}\n[Phone]: ${cleanPhone}`,
        ai_confedance: 1.0,
        user_id: customer.member_id,
        status: 'OPEN'
      });

      sessionStates.delete(cleanPhone);

      const reply = userLang === 'ar'
        ? `تم تحويل محادثتك فوراً للموظف المختص في (${departmentName}). سيقوم موظف خدمة العملاء بمساعدتك قريباً!`
        : `Your chat has been instantly transferred to a specialized agent in (${departmentName}). An agent will assist you shortly!`;

      await recordMessage(session.session_id, reply, 'SERVER', 'TEXT');
      twiml.message(reply);
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // Support keywords
    const supportKeywords = [
      'اريد التواصل مع خدمة العملاء',
      'تواصل مع خدمة العملاء',
      'تواصل',
      'دعم',
      'عملاء',
      'شكاوي',
      'شكوى',
      'شكاوى',
      'human',
      'support',
      'complaint',
      'complaints',
      'chat with support'
    ];

    // Trigger customer support list picker template
    const isSupportRequested = supportKeywords.some(kw => normalizedBody.includes(kw) || incomingBody.trim() === kw);
    if (isSupportRequested) {
      sessionStates.set(cleanPhone, { step: 'AWAITING_SUPPORT_DEPARTMENT', lang: userLang });

      const supportTemplateSid = userLang === 'ar'
        ? (process.env.SUPPORT_TEMPLATE_SID_AR || 'HX89288dad134a28816bbbe5509d1fd59e')
        : (process.env.SUPPORT_TEMPLATE_SID_EN || 'HXa5821a44a80b00d7d722871c3f266bfe');

      if (supportTemplateSid) {
        try {
          const client = getTwilioClient();
          const msgResult = await client.messages.create({
            from: fromWhatsApp,
            to: toWhatsApp,
            contentSid: supportTemplateSid
          });
          console.log(`Support Menu List Picker Template sent. SID=${msgResult.sid}`);
          await recordMessage(session.session_id, `[Support List Picker Template: ${supportTemplateSid}]`, 'SERVER', 'TEXT');
          res.type('text/xml');
          return res.send(twiml.toString());
        } catch (templateErr) {
          console.error('Failed to send Support List Picker template, falling back to plain text:', templateErr.message);
        }
      }

      // Plain text fallback
      const categories = await ServiceCategory.findAll({ where: { status: 'ACTIVE' } });
      const categoryList = categories.map((c, i) => `${i + 1}. ${c.service_name}: ${c.contact_number || '+962 6 500 0000'}`).join('\n');
      
      const responseText = userLang === 'ar'
        ? `يرجى التواصل مباشرة مع الأقسام الإدارية عبر الأرقام التالية:\n${categoryList}`
        : `Please contact the administrative departments directly using the following numbers:\n${categoryList}`;

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

      // For the Membership Services category — send Membership Services Quick Reply template
      const isMembershipCategory = selectedCategory.service_id === 'membership'
        || selectedCategory.service_id === 'membership_services'
        || selectedCategory.service_name.includes('عضوية')
        || selectedCategory.service_name.toLowerCase().includes('membership');

      if (isMembershipCategory) {
        const membershipSid = userLang === 'ar'
          ? (process.env.MEMBERSHIP_SERVICES_TEMPLATE_SID_AR || 'HXbd68f7b925e56759719c287e1c999f55')
          : process.env.MEMBERSHIP_SERVICES_TEMPLATE_SID_EN;

        if (membershipSid) {
          try {
            const client = getTwilioClient();
            const msgResult = await client.messages.create({
              from: fromWhatsApp,
              to: toWhatsApp,
              contentSid: membershipSid
            });
            console.log(`Membership Services Quick Reply Template sent. SID=${msgResult.sid}`);
            await recordMessage(session.session_id, `[Quick Reply Template: ${membershipSid}]`, 'SERVER', 'TEXT');

            sessionStates.set(cleanPhone, {
              step: 'AWAITING_SERVICE',
              services: filteredServices,
              selectedCategory,
              lang: userLang
            });

            res.type('text/xml');
            return res.send(twiml.toString());
          } catch (templateErr) {
            console.error('Failed to send Membership Services Quick Reply template, falling back to plain text:', templateErr.message);
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
    }

    // AWAITING_DELIVERY_PREFERENCE step
    if (state?.step === 'AWAITING_DELIVERY_PREFERENCE') {
      const selection = (req.body.ButtonPayload || incomingBody).trim();

      if (selection === 'delivery_no' || selection === '2' || selection.includes('لا أرغب') || selection.includes('no')) {
        const memberId = state.memberId || customer.member_id;
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers['x-forwarded-host'] || req.get('host');
        const paymentUrl = `${protocol}://${host}/payment?phone=${encodeURIComponent(cleanPhone)}&memberId=${encodeURIComponent(memberId)}&amount=5.00&address=${encodeURIComponent('نسخة إلكترونية - عبر البريد والإشعار')}`;

        sessionStates.set(cleanPhone, {
          step: 'AWAITING_PAYMENT',
          service: 'issue_certificate',
          memberId,
          targetPhone: cleanPhone,
          paymentUrl,
          amount: '5.00',
          lang: userLang
        });

        const payPrompt = userLang === 'ar'
          ? `📜 *خطوة الدفع الإلكتروني (شهادة عضوية إلكترونية)*\n━━━━━━━━━━━━━━━━━━━━\nتم تجهيز طلب شهادة العضوية الإلكترونية (رقم ${memberId}). يرجى استكمال عملية الدفع (5.00 د.أ) عبر الرابط التالي 📍:\n${paymentUrl}`
          : `📜 *Electronic Payment Step (Electronic Certificate)*\n━━━━━━━━━━━━━━━━━━━━\nYour electronic membership certificate (#${memberId}) request is ready. Please finalize your payment (5.00 JOD) using the following link 📍:\n${paymentUrl}`;

        await recordMessage(session.session_id, payPrompt, 'SERVER', 'TEXT');
        twiml.message(payPrompt);
        res.type('text/xml');
        return res.send(twiml.toString());
      }

      if (selection === 'delivery_yes' || selection === '1' || selection.includes('أرغب') || selection.includes('yes')) {
        // Dispatch cert_receiver_info_ar_jea Quick Reply template asking: "يرجى تحديد مستلم الشهادة:"
        sessionStates.set(cleanPhone, {
          step: 'AWAITING_RECEIVER_SELECTION',
          service: 'issue_certificate',
          memberId: state.memberId,
          lang: userLang
        });

        const receiverInfoSid = userLang === 'ar'
          ? (process.env.CERT_RECEIVER_INFO_TEMPLATE_SID_AR || 'HXbaf3f234788c5e7e51f3c1f671450aa8')
          : process.env.CERT_RECEIVER_INFO_TEMPLATE_SID_EN;

        if (receiverInfoSid) {
          try {
            const client = getTwilioClient();
            const msgResult = await client.messages.create({
              from: fromWhatsApp,
              to: toWhatsApp,
              contentSid: receiverInfoSid
            });
            console.log(`Certificate Receiver Info Template sent. SID=${msgResult.sid}`);
            await recordMessage(session.session_id, `[Quick Reply Template: ${receiverInfoSid}]`, 'SERVER', 'TEXT');
            res.type('text/xml');
            return res.send(twiml.toString());
          } catch (templateErr) {
            console.error('Failed to send Certificate Receiver Info template, falling back to plain text:', templateErr.message);
          }
        }

        // Plain text fallback
        const receiverPrompt = userLang === 'ar'
          ? `يرجى تحديد مستلم الشهادة:\n1. المهندس نفسه (receiver_self)\n2. شخص آخر (receiver_other)`
          : `Please specify the receiver of the certificate:\n1. Engineer himself (receiver_self)\n2. Another person (receiver_other)`;

        await recordMessage(session.session_id, receiverPrompt, 'SERVER', 'TEXT');
        twiml.message(receiverPrompt);
        res.type('text/xml');
        return res.send(twiml.toString());
      }
    }

    // AWAITING_RECEIVER_SELECTION step
    if (state?.step === 'AWAITING_RECEIVER_SELECTION') {
      const selection = (req.body.ButtonPayload || incomingBody).trim();
      const memberId = state.memberId || customer.member_id;

      const isSelf = selection === 'receiver_self' || selection === '1' || selection.includes('المهندس نفسه') || selection.includes('self');

      if (isSelf) {
        const targetPhone = customer?.phone || cleanPhone;
        sessionStates.set(cleanPhone, {
          step: 'AWAITING_DELIVERY_ADDRESS',
          service: 'issue_certificate',
          memberId,
          receiverType: 'Engineer Himself',
          targetPhone,
          lang: userLang
        });

        const addressTemplateSid = userLang === 'ar'
          ? (process.env.ADDRESS_TEMPLATE_SID_AR || 'HX43bf47e5343fa31bed8c769e3361284f')
          : (process.env.ADDRESS_TEMPLATE_SID_EN || 'HX9e8b1fe91746f2084f3ae1be18698832');

        if (addressTemplateSid) {
          try {
            const client = getTwilioClient();
            const msgResult = await client.messages.create({
              from: fromWhatsApp,
              to: toWhatsApp,
              contentSid: addressTemplateSid
            });
            console.log(`Address Text Template sent for engineer. SID=${msgResult.sid}`);
            await recordMessage(session.session_id, `[Address Template: ${addressTemplateSid}]`, 'SERVER', 'TEXT');
            res.type('text/xml');
            return res.send(twiml.toString());
          } catch (templateErr) {
            console.error('Failed to send Address template for engineer:', templateErr.message);
          }
        }

        const addressPrompt = userLang === 'ar'
          ? `ممتاز! أخيراً، يرجى كتابة عنوان المستلم بالتفصيل 📍 (المدينة، المنطقة، الشارع، رقم البناية):`
          : `Great! Finally, please provide the detailed address of the receiver 📍 (City, Area, Street, Building Number):`;

        await recordMessage(session.session_id, addressPrompt, 'SERVER', 'TEXT');
        twiml.message(addressPrompt);
        res.type('text/xml');
        return res.send(twiml.toString());
      } else {
        // receiver_other: Prompt for other receiver phone number using phone_jea_ar template
        sessionStates.set(cleanPhone, {
          step: 'AWAITING_RECEIVER_PHONE',
          service: 'issue_certificate',
          memberId,
          receiverType: 'Other Receiver',
          lang: userLang
        });

        const phoneTemplateSid = userLang === 'ar'
          ? (process.env.PHONE_REQUEST_TEMPLATE_SID_AR || 'HXb8e3c368aaccc5fd50fa51a588b97ec7')
          : (process.env.PHONE_REQUEST_TEMPLATE_SID_EN || 'HX4138986d24eb743ebf8b8967e532363b');

        if (phoneTemplateSid) {
          try {
            const client = getTwilioClient();
            const msgResult = await client.messages.create({
              from: fromWhatsApp,
              to: toWhatsApp,
              contentSid: phoneTemplateSid
            });
            console.log(`Phone Request Text Template sent for other receiver. SID=${msgResult.sid}`);
            await recordMessage(session.session_id, `[Phone Request Template: ${phoneTemplateSid}]`, 'SERVER', 'TEXT');
            res.type('text/xml');
            return res.send(twiml.toString());
          } catch (templateErr) {
            console.error('Failed to send Phone Request template for other receiver:', templateErr.message);
          }
        }

        const phonePrompt = userLang === 'ar'
          ? `شكراً لك. يرجى إدخال رقم هاتف المستلم للتواصل معه عند التوصيل 📱`
          : `Thank you. Please enter the phone number of the receiver for delivery contact 📱`;

        await recordMessage(session.session_id, phonePrompt, 'SERVER', 'TEXT');
        twiml.message(phonePrompt);
        res.type('text/xml');
        return res.send(twiml.toString());
      }
    }

    // AWAITING_PHONE_ERROR_CHOICE step
    if (state?.step === 'AWAITING_PHONE_ERROR_CHOICE') {
      const choice = incomingBody.trim().toLowerCase();

      if (choice === '1' || choice.includes('إعادة') || choice.includes('اعادة') || choice.includes('retry')) {
        sessionStates.set(cleanPhone, {
          step: 'AWAITING_RECEIVER_PHONE',
          service: 'issue_certificate',
          memberId: state.memberId,
          lang: userLang
        });

        const phoneTemplateSid = userLang === 'ar'
          ? (process.env.PHONE_REQUEST_TEMPLATE_SID_AR || 'HXb8e3c368aaccc5fd50fa51a588b97ec7')
          : (process.env.PHONE_REQUEST_TEMPLATE_SID_EN || 'HX4138986d24eb743ebf8b8967e532363b');

        if (phoneTemplateSid) {
          try {
            const client = getTwilioClient();
            const msgResult = await client.messages.create({
              from: fromWhatsApp,
              to: toWhatsApp,
              contentSid: phoneTemplateSid
            });
            console.log(`Phone Request Text Template sent on retry. SID=${msgResult.sid}`);
            await recordMessage(session.session_id, `[Phone Request Template: ${phoneTemplateSid}]`, 'SERVER', 'TEXT');
            res.type('text/xml');
            return res.send(twiml.toString());
          } catch (templateErr) {
            console.error('Failed to send Phone Request template on retry:', templateErr.message);
          }
        }

        const phonePrompt = userLang === 'ar'
          ? `يرجى إدخال رقم هاتف محلي أردني صحيح (مثل: 0791234567 أو +962791234567) 📱`
          : `Please enter a valid Jordanian phone number (e.g. 0791234567 or +962791234567) 📱`;

        await recordMessage(session.session_id, phonePrompt, 'SERVER', 'TEXT');
        twiml.message(phonePrompt);
        res.type('text/xml');
        return res.send(twiml.toString());
      }

      if (choice === '2' || choice.includes('رئيسية') || choice.includes('رئيسيه') || choice.includes('main')) {
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
            console.log(`Greeting template sent after main menu choice. SID=${msgResult.sid}`);
            await recordMessage(session.session_id, `[List Picker Template: ${greetingSid}]`, 'SERVER', 'TEXT');
            sessionStates.set(cleanPhone, { step: 'AWAITING_CATEGORY', categories, lang: userLang });
            res.type('text/xml');
            return res.send(twiml.toString());
          } catch (err) {
            console.error('Failed to send greeting template:', err.message);
          }
        }

        const categoryList = categories.map((c, i) => `${i + 1}. ${c.service_name}`).join('\n');
        const welcomeText = getTranslation(userLang, 'welcomePrompt', { name: displayName, list: categoryList });
        sessionStates.set(cleanPhone, { step: 'AWAITING_CATEGORY', categories, lang: userLang });
        await recordMessage(session.session_id, welcomeText, 'SERVER', 'TEXT');
        twiml.message(welcomeText);
        res.type('text/xml');
        return res.send(twiml.toString());
      }

      // Invalid choice fallback prompt
      const invalidOptionMsg = userLang === 'ar'
        ? `❌ خيار غير صحيح. يرجى الاختيار:\n1. إعادة محاولة إدخال رقم الهاتف 📱\n2. العودة للقائمة الرئيسية 🏠`
        : `❌ Invalid option. Please choose:\n1. Retry entering phone number 📱\n2. Return to Main Menu 🏠`;

      await recordMessage(session.session_id, invalidOptionMsg, 'SERVER', 'TEXT');
      twiml.message(invalidOptionMsg);
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // AWAITING_RECEIVER_PHONE step
    if (state?.step === 'AWAITING_RECEIVER_PHONE') {
      const phoneInput = incomingBody.trim();
      const isValidJordanianPhone = /^(?:\+?962|00962|0)?7[789]\d{7}$/.test(phoneInput.replace(/\s+/g, ''));
      const memberId = state.memberId || customer.member_id;

      let existingCustomer = null;
      if (isValidJordanianPhone) {
        const normalized = normalizePhone(phoneInput);
        const rawWithoutPlus = normalized.replace('+', '');
        existingCustomer = await Customer.findOne({
          where: {
            [Op.or]: [
              { phone: phoneInput },
              { phone: normalized },
              { phone: rawWithoutPlus }
            ]
          }
        });
      }

      if (!isValidJordanianPhone || !existingCustomer) {
        sessionStates.set(cleanPhone, {
          step: 'AWAITING_PHONE_ERROR_CHOICE',
          service: 'issue_certificate',
          memberId,
          lang: userLang
        });

        const errorPrompt = userLang === 'ar'
          ? `❌ رقم الهاتف غير صحيح أو غير مسجل بالنظام.\n\nيرجى الاختيار:\n1. إعادة محاولة إدخال رقم الهاتف 📱\n2. العودة للقائمة الرئيسية 🏠`
          : `❌ Invalid phone number or not registered in the system.\n\nPlease choose:\n1. Retry entering phone number 📱\n2. Return to Main Menu 🏠`;

        await recordMessage(session.session_id, errorPrompt, 'SERVER', 'TEXT');
        twiml.message(errorPrompt);
        res.type('text/xml');
        return res.send(twiml.toString());
      }

      // Valid phone -> Transition to AWAITING_DELIVERY_ADDRESS and send address template
      sessionStates.set(cleanPhone, {
        step: 'AWAITING_DELIVERY_ADDRESS',
        service: 'issue_certificate',
        memberId,
        receiverType: 'Other Receiver',
        targetPhone: phoneInput,
        lang: userLang
      });

      const addressTemplateSid = userLang === 'ar'
        ? (process.env.ADDRESS_TEMPLATE_SID_AR || 'HX43bf47e5343fa31bed8c769e3361284f')
        : (process.env.ADDRESS_TEMPLATE_SID_EN || 'HX9e8b1fe91746f2084f3ae1be18698832');

      if (addressTemplateSid) {
        try {
          const client = getTwilioClient();
          const msgResult = await client.messages.create({
            from: fromWhatsApp,
            to: toWhatsApp,
            contentSid: addressTemplateSid
          });
          console.log(`Address Text Template sent after phone input. SID=${msgResult.sid}`);
          await recordMessage(session.session_id, `[Address Template: ${addressTemplateSid}]`, 'SERVER', 'TEXT');
          res.type('text/xml');
          return res.send(twiml.toString());
        } catch (templateErr) {
          console.error('Failed to send Address template after phone input:', templateErr.message);
        }
      }

      const addressPrompt = userLang === 'ar'
        ? `ممتاز! أخيراً، يرجى كتابة عنوان المستلم بالتفصيل 📍 (المدينة، المنطقة، الشارع، رقم البناية):`
        : `Great! Finally, please provide the detailed address of the receiver 📍 (City, Area, Street, Building Number):`;

      await recordMessage(session.session_id, addressPrompt, 'SERVER', 'TEXT');
      twiml.message(addressPrompt);
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // AWAITING_DELIVERY_ADDRESS step
    if (state?.step === 'AWAITING_DELIVERY_ADDRESS') {
      const addressInput = incomingBody.trim();
      const memberId = state.memberId || customer.member_id;
      const targetPhone = state.targetPhone || customer.phone || cleanPhone;
      const receiverType = state.receiverType || 'Engineer Himself';

      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.get('host');
      const paymentUrl = `${protocol}://${host}/payment?phone=${encodeURIComponent(targetPhone)}&memberId=${encodeURIComponent(memberId)}&amount=15.00&address=${encodeURIComponent(addressInput)}`;

      sessionStates.set(cleanPhone, {
        step: 'AWAITING_PAYMENT',
        service: 'issue_certificate',
        memberId,
        targetPhone,
        receiverType,
        addressInput,
        paymentUrl,
        lang: userLang
      });

      const payPrompt = userLang === 'ar'
        ? `💳 *خطوة الدفع الإلكتروني*\n━━━━━━━━━━━━━━━━━━━━\nشكراً لك! لإتمام طلب إصدار وتوصيل شهادة العضوية الورقية، يرجى استكمال عملية الدفع (15.00 د.أ) عبر الرابط التالي 📍:\n${paymentUrl}`
        : `💳 *Electronic Payment Step*\n━━━━━━━━━━━━━━━━━━━━\nThank you! To complete your membership certificate physical delivery order, please finalize your payment (15.00 JOD) using the following link 📍:\n${paymentUrl}`;

      await recordMessage(session.session_id, payPrompt, 'SERVER', 'TEXT');
      twiml.message(payPrompt);
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // AWAITING_ENGINEER_NUMBER step
    if (state?.step === 'AWAITING_ENGINEER_NUMBER') {
      const rawInput = incomingBody.trim();
      const engNumberInput = parseArabicDigits(rawInput).replace(/\D/g, '');
      const isValidFormat = /^\d{6}$/.test(engNumberInput);

      let existingCustomer = null;
      if (isValidFormat) {
        existingCustomer = await Customer.findOne({
          where: { member_id: engNumberInput }
        });
        if (!existingCustomer && customer) {
          existingCustomer = customer;
        }
      }

      if (!isValidFormat || !existingCustomer) {
        sessionStates.set(cleanPhone, {
          step: 'AWAITING_MEMBER_NUM_ERROR_CHOICE',
          service: 'issue_certificate',
          lang: userLang
        });

        const errorPrompt = userLang === 'ar'
          ? `❌ رقم العضوية غير صحيح أو غير مسجل.\n\nيرجى الاختيار:\n1. إعادة محاولة إدخال رقم العضوية (6 أرقام) 🔢\n2. العودة للقائمة الرئيسية 🏠`
          : `❌ Invalid membership number or not registered.\n\nPlease choose:\n1. Retry entering membership number (6 digits) 🔢\n2. Return to Main Menu 🏠`;

        await recordMessage(session.session_id, errorPrompt, 'SERVER', 'TEXT');
        twiml.message(errorPrompt);
        res.type('text/xml');
        return res.send(twiml.toString());
      }

      // Save memberId and dispatch Delivery Preference Quick Reply template
      sessionStates.set(cleanPhone, {
        step: 'AWAITING_DELIVERY_PREFERENCE',
        service: 'issue_certificate',
        memberId: engNumberInput,
        lang: userLang
      });

      const preferenceTemplateSid = userLang === 'ar'
        ? (process.env.CERT_DELIVERY_PREFERENCE_TEMPLATE_SID_AR || 'HX27c980acc261b098fcbea5f24ac7f841')
        : process.env.CERT_DELIVERY_PREFERENCE_TEMPLATE_SID_EN;

      if (preferenceTemplateSid) {
        try {
          const client = getTwilioClient();
          const msgResult = await client.messages.create({
            from: fromWhatsApp,
            to: toWhatsApp,
            contentSid: preferenceTemplateSid
          });
          console.log(`Certificate Delivery Preference Template sent after member number validation. SID=${msgResult.sid}`);
          await recordMessage(session.session_id, `[Quick Reply Template: ${preferenceTemplateSid}]`, 'SERVER', 'TEXT');
          res.type('text/xml');
          return res.send(twiml.toString());
        } catch (templateErr) {
          console.error('Failed to send Certificate Delivery Preference template, falling back to plain text:', templateErr.message);
        }
      }

      // Plain text fallback
      const prefPrompt = userLang === 'ar'
        ? `هل ترغب بتوصيل الشهادة الورقية؟\n1. أرغب في التوصيل (delivery_yes)\n2. لا أرغب في التوصيل (delivery_no)`
        : `Would you like physical delivery of the certificate?\n1. Yes, I want delivery (delivery_yes)\n2. No, I do not want delivery (delivery_no)`;

      await recordMessage(session.session_id, prefPrompt, 'SERVER', 'TEXT');
      twiml.message(prefPrompt);
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // AWAITING_MEMBER_NUM_ERROR_CHOICE step
    if (state?.step === 'AWAITING_MEMBER_NUM_ERROR_CHOICE') {
      const choice = incomingBody.trim().toLowerCase();

      if (choice === '1' || choice.includes('إعادة') || choice.includes('اعادة') || choice.includes('retry')) {
        sessionStates.set(cleanPhone, {
          step: 'AWAITING_ENGINEER_NUMBER',
          service: 'issue_certificate',
          lang: userLang
        });

        const engNumberTemplateSid = userLang === 'ar'
          ? (process.env.CERT_REQUEST_ENG_NUMBER_TEMPLATE_SID_AR || 'HXe92a8ba024c28960a5e45474dbef26ca')
          : process.env.CERT_REQUEST_ENG_NUMBER_TEMPLATE_SID_EN;

        if (engNumberTemplateSid) {
          try {
            const client = getTwilioClient();
            const msgResult = await client.messages.create({
              from: fromWhatsApp,
              to: toWhatsApp,
              contentSid: engNumberTemplateSid
            });
            console.log(`Engineer Member Number Text Template sent on retry. SID=${msgResult.sid}`);
            await recordMessage(session.session_id, `[Text Template: ${engNumberTemplateSid}]`, 'SERVER', 'TEXT');
            res.type('text/xml');
            return res.send(twiml.toString());
          } catch (templateErr) {
            console.error('Failed to send Engineer Member Number template on retry:', templateErr.message);
          }
        }

        const engPrompt = userLang === 'ar'
          ? `يرجى إدخال رقم العضوية النقابي الخاص بك (6 أرقام):`
          : `Please enter your 6-digit syndicate membership number:`;

        await recordMessage(session.session_id, engPrompt, 'SERVER', 'TEXT');
        twiml.message(engPrompt);
        res.type('text/xml');
        return res.send(twiml.toString());
      }

      if (choice === '2' || choice.includes('رئيسية') || choice.includes('رئيسيه') || choice.includes('main')) {
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
            console.log(`Greeting template sent after main menu choice. SID=${msgResult.sid}`);
            await recordMessage(session.session_id, `[List Picker Template: ${greetingSid}]`, 'SERVER', 'TEXT');
            sessionStates.set(cleanPhone, { step: 'AWAITING_CATEGORY', categories, lang: userLang });
            res.type('text/xml');
            return res.send(twiml.toString());
          } catch (err) {
            console.error('Failed to send greeting template:', err.message);
          }
        }

        const categoryList = categories.map((c, i) => `${i + 1}. ${c.service_name}`).join('\n');
        const welcomeText = getTranslation(userLang, 'welcomePrompt', { name: displayName, list: categoryList });
        sessionStates.set(cleanPhone, { step: 'AWAITING_CATEGORY', categories, lang: userLang });
        await recordMessage(session.session_id, welcomeText, 'SERVER', 'TEXT');
        twiml.message(welcomeText);
        res.type('text/xml');
        return res.send(twiml.toString());
      }

      // Invalid choice fallback prompt
      const invalidOptionMsg = userLang === 'ar'
        ? `❌ خيار غير صحيح. يرجى الاختيار:\n1. إعادة محاولة إدخال رقم العضوية 🔢\n2. العودة للقائمة الرئيسية 🏠`
        : `❌ Invalid option. Please choose:\n1. Retry entering membership number 🔢\n2. Return to Main Menu 🏠`;

      await recordMessage(session.session_id, invalidOptionMsg, 'SERVER', 'TEXT');
      twiml.message(invalidOptionMsg);
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // Global Quick Reply button action check for issue_certificate
    const trimmedBody = incomingBody.trim();
    const isCertificateRequested = trimmedBody === 'issue_certificate'
      || trimmedBody === 'إصدار شهادة عضوية'
      || trimmedBody === 'Issue Membership Certificate'
      || req.body.ButtonPayload === 'issue_certificate';

    if (isCertificateRequested) {
      sessionStates.set(cleanPhone, {
        step: 'AWAITING_ENGINEER_NUMBER',
        service: 'issue_certificate',
        lang: userLang
      });

      const engNumberTemplateSid = userLang === 'ar'
        ? (process.env.CERT_REQUEST_ENG_NUMBER_TEMPLATE_SID_AR || 'HXe92a8ba024c28960a5e45474dbef26ca')
        : process.env.CERT_REQUEST_ENG_NUMBER_TEMPLATE_SID_EN;

      if (engNumberTemplateSid) {
        try {
          const client = getTwilioClient();
          const msgResult = await client.messages.create({
            from: fromWhatsApp,
            to: toWhatsApp,
            contentSid: engNumberTemplateSid
          });
          console.log(`Engineer Member Number Text Template sent. SID=${msgResult.sid}`);
          await recordMessage(session.session_id, `[Text Template: ${engNumberTemplateSid}]`, 'SERVER', 'TEXT');
          res.type('text/xml');
          return res.send(twiml.toString());
        } catch (templateErr) {
          console.error('Failed to send Engineer Member Number template, falling back to plain text:', templateErr.message);
        }
      }

      // Plain text fallback
      const engPrompt = userLang === 'ar'
        ? `يرجى إدخال رقم العضوية النقابي الخاص بك (6 أرقام):`
        : `Please enter your 6-digit syndicate membership number:`;

      await recordMessage(session.session_id, engPrompt, 'SERVER', 'TEXT');
      twiml.message(engPrompt);
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // AWAITING_SERVICE step
    if (state?.step === 'AWAITING_SERVICE') {
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

            return sendCustomerSatisfactionFlow({
              fromWhatsApp,
              toWhatsApp,
              cleanPhone,
              session,
              ticketId: null,
              userLang,
              twiml,
              res,
              introMessage: reply
            });
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

        return sendCustomerSatisfactionFlow({
          fromWhatsApp,
          toWhatsApp,
          cleanPhone,
          session,
          ticketId,
          userLang,
          twiml,
          res
        });
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

        return sendCustomerSatisfactionFlow({
          fromWhatsApp,
          toWhatsApp,
          cleanPhone,
          session,
          ticketId,
          userLang,
          twiml,
          res
        });
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
        // Case 2 & 3: Low confidence (< 20%)
        // Keywords indicating a problem or a request to perform a service/transaction
        const ticketKeywords = [
          'مشكلة', 'مشكله', 'عطل', 'خلل', 'شكوى', 'شكوي', 'خطأ', 'خطا',
          'لا يعمل', 'مش زابط', 'خراب', 'مستعجل', 'تكت', 'تذكره', 'تذكرة',
          'سجل', 'تسجيل', 'اشتراك', 'تجديد', 'تقاعد', 'تقديم', 'طلب',
          'error', 'problem', 'issue', 'bug', 'complaint', 'failed', 'not working',
          'register', 'renew', 'apply', 'ticket', 'pension', 'subscribe'
        ];

        const needsTicket = ticketKeywords.some(kw => incomingBody.toLowerCase().includes(kw));

        if (needsTicket) {
          // Case 2: Problem or service request -> Create ticket IMMEDIATELY
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

          const introMsg = userLang === 'ar'
            ? `شكراً لك! تم تسجيل طلبك بنجاح وفتح تذكرة دعم برقم (${ticketId}) لمتابعة استفسارك مع القسم المختص.`
            : `Thank you! Your request has been successfully registered and a support ticket (${ticketId}) has been opened to follow up with our team.`;

          return sendCustomerSatisfactionFlow({
            fromWhatsApp,
            toWhatsApp,
            cleanPhone,
            session,
            ticketId,
            userLang,
            twiml,
            res,
            introMessage: introMsg
          });
        } else {
          // Case 3: General query/trivia -> Simply answer "I don't know / couldn't find answer"
          sessionStates.delete(cleanPhone);
          await session.update({ status: 'CLOSED' });

          const responseText = userLang === 'ar'
            ? `عذراً، لم أتمكن من العثور على إجابة لاستفسارك في دليل الخدمات المعتمد.`
            : `Sorry, I couldn't find an answer to your query in our service guide.`;

          await recordMessage(session.session_id, responseText, 'SERVER', 'TEXT');
          twiml.message(responseText);
          res.type('text/xml');
          return res.send(twiml.toString());
        }
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

exports.sessionStates = sessionStates;

/**
 * Handle Payment Submission from Web Portal (payment.html)
 * POST /api/whatsapp/payment/submit
 */
exports.submitPayment = async (req, res, next) => {
  try {
    const { cleanPhone, memberId, amount, paymentMethod, transactionRef, address, status, failureReason } = req.body;

    if (!cleanPhone || !memberId) {
      return res.status(400).json({ success: false, message: 'Missing required fields: cleanPhone and memberId' });
    }

    const rawDigits = cleanPhone.replace(/\D/g, '');
    const formattedPhone = '+' + (rawDigits.startsWith('962') ? rawDigits : ('962' + rawDigits.replace(/^0+/, '')));
    const toWhatsApp = `whatsapp:${formattedPhone}`;
    const fromWhatsApp = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';

    const isFailed = status === 'failed' || req.body.success === false;

    if (isFailed) {
      const activeState = sessionStates.get(formattedPhone.replace('+', '')) || sessionStates.get(rawDigits) || {};
      const savedUrl = activeState.paymentUrl || `https://jpa-demo.eqratech.com/payment?phone=${encodeURIComponent(cleanPhone)}&memberId=${encodeURIComponent(memberId)}&amount=${amount || '15.00'}`;

      sessionStates.set(formattedPhone.replace('+', ''), {
        step: 'AWAITING_PAYMENT_FAILED_CHOICE',
        memberId,
        targetPhone: formattedPhone,
        paymentUrl: savedUrl,
        amount: amount || '15.00',
        lang: 'ar'
      });
      sessionStates.set(rawDigits, sessionStates.get(formattedPhone.replace('+', '')));

      const failMsg = `❌ *تعذرت عملية الدفع الإلكتروني*\n━━━━━━━━━━━━━━━━━━━━\nعذراً، لم نتمكن من استكمال عملية الدفع لشهادة العضوية (${failureReason || 'البطاقة مرفوضة من قبل البنك'}).\n\nيرجى تحديد الخيار المناسب:\n1. 💳 إعادة محاولة الدفع الإلكتروني\n2. 🏠 العودة للقائمة الرئيسية`;

      const client = getTwilioClient();
      if (client) {
        try {
          await client.messages.create({
            from: fromWhatsApp,
            to: toWhatsApp,
            body: failMsg
          });
          console.log(`Payment failure message dispatched to ${toWhatsApp}`);
        } catch (fErr) {
          console.error('Failed to send WhatsApp payment failure message:', fErr.message);
        }
      }

      return res.status(200).json({
        success: false,
        message: 'Payment failure recorded and options dispatched to WhatsApp',
        transactionRef
      });
    }

    let customerRecord = await Customer.findOne({ where: { member_id: memberId } });
    if (!customerRecord) {
      customerRecord = await Customer.findOne({ where: { phone: formattedPhone } });
    }
    if (!customerRecord) {
      customerRecord = await Customer.create({
        member_id: memberId,
        phone: formattedPhone,
        role: 'ENGINEER'
      });
    }

    const ticketId = 'tkt_' + crypto.randomUUID();
    await Ticket.create({
      ticket_id: ticketId,
      ticket_priority: 'MEDIUM',
      title: `Membership Certificate Order - Payment Received (${paymentMethod || 'Online'})`,
      content: `[Membership Certificate Payment Confirmed]\nMember ID: ${memberId}\nPhone: ${formattedPhone}\nAmount: ${amount || '15.00'} JOD\nPayment Method: ${paymentMethod || 'Online'}\nTransaction Ref: ${transactionRef || 'N/A'}\nDelivery Address: ${address || 'N/A'}`,
      ai_confedance: 1.0,
      user_id: customerRecord.member_id,
      status: 'OPEN'
    });

    const confirmMsg = `💳 *إيصال وتأكيد عملية الدفع*\n━━━━━━━━━━━━━━━━━━━━\nتم استلام مبلغ (${amount || '15.00'} د.أ) بنجاح لشهادة العضوية برقم (${memberId}) عبر ${paymentMethod || 'الدفع الإلكتروني'}.\n🔢 رقم العملية: ${transactionRef || 'N/A'}\n📱 رقم الهاتف: ${formattedPhone}\n📍 عنوان التوصيل: ${address || 'N/A'}\n\nشكراً لك! تم تسجيل طلبك وإحالتك إلى قسم التجهيز والتوصيل.`;

    const client = getTwilioClient();
    if (client) {
      try {
        await client.messages.create({
          from: fromWhatsApp,
          to: toWhatsApp,
          body: confirmMsg
        });
        console.log(`Payment WhatsApp Receipt sent to ${toWhatsApp}`);
      } catch (tErr) {
        console.error('Failed to send WhatsApp payment receipt message:', tErr.message);
      }
    }

    sessionStates.set(formattedPhone.replace('+', ''), {
      step: 'AWAITING_RATING',
      ticketId,
      lang: 'ar'
    });

    const flowSid = process.env.CUSTOMER_SATISFACTION_TEMPLATE_SID_AR || 'HX0827ed175724bb0ee0e81b0591bf92de';
    const delayMs = process.env.NODE_ENV === 'test' ? 0 : 3000;

    if (client && flowSid) {
      setTimeout(async () => {
        try {
          const msgResult = await client.messages.create({
            from: fromWhatsApp,
            to: toWhatsApp,
            contentSid: flowSid
          });
          console.log(`Rating Flow Template sent after payment completion. SID=${msgResult.sid}`);
        } catch (fErr) {
          console.error('Failed to send Rating Flow after payment:', fErr.message);
        }
      }, delayMs);
    }

    return res.status(200).json({
      success: true,
      message: 'Payment recorded and rating flow dispatched successfully',
      ticketId,
      transactionRef
    });
  } catch (err) {
    console.error('submitPayment error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Queued WhatsApp Webhook Entry Point
 * POST /api/whatsapp/webhook
 *
 * In NODE_ENV=test: calls receiveWebhook directly (synchronous) so tests get
 * real TwiML responses and assertions work normally.
 *
 * In production: returns 200 to Twilio immediately (<5ms) then processes the
 * message asynchronously via WebhookQueue to avoid Twilio's 15-second timeout.
 */
exports.receiveWebhookQueued = async (req, res, next) => {
  // ── TEST MODE: bypass queue for synchronous test assertions ────────────────
  if (process.env.NODE_ENV === 'test') {
    return exports.receiveWebhook(req, res, next);
  }

  try {
    const { From, MessageStatus, SmsStatus, MessageSid } = req.body;

    // Status callbacks → pass through immediately, no queue needed
    if (MessageStatus || (SmsStatus && SmsStatus !== 'received')) {
      console.log(`[Queue] Status callback: SID=${MessageSid}, Status=${SmsStatus || MessageStatus}`);
      return res.sendStatus(200);
    }

    if (!From) {
      return res.status(400).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }

    const cleanPhone = From.replace('whatsapp:', '').trim();

    // Inject host so queue worker can reconstruct public URLs
    const body = {
      ...req.body,
      _host: req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000',
      _proto: req.headers['x-forwarded-proto'] || req.protocol || 'http'
    };

    // Enqueue for async processing
    const webhookQueue = require('../services/webhookQueue');
    const depth = webhookQueue.enqueue(cleanPhone, body);

    console.log(`[Queue] ✉ Webhook from ${cleanPhone} queued (depth=${depth}). Returning 200 to Twilio immediately.`);

    // Return empty TwiML — Twilio won't retry since we responded in time
    res.type('text/xml');
    return res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  } catch (err) {
    next(err);
  }
};


/**
 * GET /api/queue/status
 * Returns live webhook queue metrics for monitoring.
 */
exports.getQueueStatus = (req, res) => {
  try {
    const webhookQueue = require('../services/webhookQueue');
    return res.json({ success: true, data: webhookQueue.getStatus() });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
