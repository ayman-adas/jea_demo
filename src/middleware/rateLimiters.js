const twilio = require('twilio');
const rateLimit = require('express-rate-limit');

// Helper to return a TwiML XML message directly to the user's WhatsApp on rate limit
const sendRateLimitTwiML = (res, message) => {
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(message);
  res.type('text/xml');
  return res.status(200).send(twiml.toString());
};

/**
 * Brute force protection for admin login & OTP endpoints
 * Max 5 login attempts per 15 minutes per IP/username
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Using bracket notation req['ip'] to bypass express-rate-limit's regex check for IPv6 fallback
    return req.body.username || req['ip'];
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      code: 'TOO_MANY_REQUESTS',
      message: 'محاولات تسجيل دخول كثيرة جداً. يرجى المحاولة بعد 15 دقيقة.'
    });
  }
});

/**
 * WhatsApp webhook rate limiting: Max 10 messages per minute per user phone
 */
const whatsappMinutelyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.body.From || req['ip'];
  },
  skip: (req) => req.body && (req.body.MessageStatus || (req.body.SmsStatus && req.body.SmsStatus !== 'received')),
  handler: (req, res) => {
    // Bilingual response for direct localization support
    const bilingualMessage = 
      '⚠️ لقد تجاوزت الحد المسموح به من الرسائل في الدقيقة الواحدة. يرجى الانتظار قليلاً قبل المحاولة مجدداً.\n\n' +
      '⚠️ You have exceeded the allowed message rate per minute. Please wait a moment and try again.';
    sendRateLimitTwiML(res, bilingualMessage);
  }
});

/**
 * WhatsApp webhook rate limiting: Max 200 messages per 24 hours per user phone
 */
const whatsappDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.body.From || req['ip'];
  },
  skip: (req) => req.body && (req.body.MessageStatus || (req.body.SmsStatus && req.body.SmsStatus !== 'received')),
  handler: (req, res) => {
    // Bilingual response for direct localization support
    const bilingualMessage = 
      '⚠️ لقد تجاوزت الحد الأقصى المسموح به من الرسائل لهذا اليوم. يرجى المحاولة غداً.\n\n' +
      '⚠️ You have exceeded the daily message limit. Please try again tomorrow.';
    sendRateLimitTwiML(res, bilingualMessage);
  }
});

module.exports = {
  authLimiter,
  whatsappMinutelyLimiter,
  whatsappDailyLimiter
};
