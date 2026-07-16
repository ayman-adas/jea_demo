const twilio = require('twilio');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { uploadToFTP } = require('../config/ftp');
const { Customer, User, Session, Message, ServiceCategory, QA, Ticket, Notification, EmployeeServiceCategory, Rating } = require('../models');
const { getTranslation } = require('../config/localization');

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

    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(tempPath);
      const protocol = mediaUrl.startsWith('https') ? https : http;
      protocol.get(mediaUrl, (response) => {
        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      }).on('error', (err) => {
        fs.unlink(tempPath, () => {});
        reject(err);
      });
    });

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

/**
 * Send a WhatsApp message
 * POST /api/whatsapp/send
 * Body: { "to": "+1234567890", "message": "Hello World!" }
 */
exports.sendWhatsApp = async (req, res, next) => {
  try {
    const { to, message } = req.body;

    if (!to || !message) {
      const err = new Error('Fields "to" and "message" are required in the request body.');
      err.statusCode = 400;
      throw err;
    }

    const fromWhatsApp = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';
    const targetTo = formatWhatsAppNumber(to);
    const client = getTwilioClient();

    console.log(`Sending WhatsApp message to ${targetTo} from ${fromWhatsApp}...`);

    const response = await client.messages.create({
      from: fromWhatsApp,
      to: targetTo,
      body: message
    });

    res.json({
      success: true,
      messageSid: response.sid,
      status: response.status,
      to: response.to,
      from: response.from,
      body: response.body
    });
  } catch (err) {
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
    const { From, Body, MessageSid } = req.body;

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

    // Default conversational menu keywords
    const resetKeywords = ['hello', 'hi', 'start', 'restart', 'menu', 'مرحبا'];
    if (resetKeywords.includes(normalizedBody)) {
      const categories = await ServiceCategory.findAll({ where: { status: 'ACTIVE' } });

      if (categories.length === 0) {
        const reply = getTranslation(userLang, 'welcomeNoCategories', { name: customer.user.name });
        twiml.message(reply);
        res.type('text/xml');
        return res.send(twiml.toString());
      }

      const categoryList = categories.map((c, i) => `${i + 1}. ${c.service_name}`).join('\n');
      const responseText = getTranslation(userLang, 'welcomePrompt', { name: customer.user.name, list: categoryList });

      sessionStates.set(cleanPhone, { step: 'AWAITING_CATEGORY', categories, lang: userLang });
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
        selectedCategory = state.categories.find(
          c => c.service_name.toLowerCase() === incomingBody.trim().toLowerCase()
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
      const selection = Number.parseInt(incomingBody.trim(), 10);
      let selectedService = null;

      if (!Number.isNaN(selection) && selection > 0 && selection <= state.services.length) {
        selectedService = state.services[selection - 1];
      } else {
        selectedService = state.services.find(
          s => s.id.toLowerCase() === incomingBody.trim().toLowerCase()
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
    // Natural Language Search / Handover fallback
    // ========================================================
    const words = incomingBody.trim().split(/\s+/).filter(w => w.length >= 3);
    let qaMatch = null;

    if (words.length > 0) {
      const allQAs = await QA.findAll({ where: { status: 'ACTIVE' } });
      qaMatch = allQAs.find(qa => {
        const matchCount = words.filter(word => qa.content.toLowerCase().includes(word.toLowerCase())).length;
        return matchCount >= Math.min(words.length, 2);
      });
    }

    if (qaMatch) {
      await recordMessage(session.session_id, qaMatch.content, 'SERVER', 'TEXT');
      twiml.message(qaMatch.content);
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // Handover fallback: request does not exist in QA (displays departments list and direct numbers)
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
    res.send(twiml.toString());
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
