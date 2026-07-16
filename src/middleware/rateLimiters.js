const rateLimit = require('express-rate-limit');

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
    return req.body.username || req.ip;
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
    // If webhook, extract Twilio sender phone (From)
    return req.body.From || req.ip;
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      code: 'LIMIT_EXCEEDED',
      message: 'لقد تجاوزت الحد المسموح به من الرسائل في الدقيقة الواحدة.'
    });
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
    return req.body.From || req.ip;
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      code: 'LIMIT_EXCEEDED',
      message: 'لقد تجاوزت الحد المسموح به من الرسائل لهذا اليوم.'
    });
  }
});

module.exports = {
  authLimiter,
  whatsappMinutelyLimiter,
  whatsappDailyLimiter
};
