const twilio = require('twilio');

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
exports.receiveWebhook = (req, res, next) => {
  try {
    const { From, Body, MessageSid } = req.body;

    console.log(`\n--- Incoming WhatsApp Message ---`);
    console.log(`From: ${From}`);
    console.log(`Body: ${Body}`);
    console.log(`MessageSid: ${MessageSid}`);
    console.log(`---------------------------------\n`);

    const { MessagingResponse } = twilio.twiml;
    const twiml = new MessagingResponse();

    // Send a response back to the sender
    twiml.message(`Hello! We received your message: "${Body}"`);

    res.type('text/xml');
    res.send(twiml.toString());
  } catch (err) {
    next(err);
  }
};
