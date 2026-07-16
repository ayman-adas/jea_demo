const Joi = require('joi');

/**
 * Helper to validate request body using a Joi schema
 */
const validateBody = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false, allowUnknown: true });
    
    if (error) {
      const details = error.details.map(d => ({
        field: d.path.join('.'),
        message: d.message
      }));
      
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'خطأ في التحقق من البيانات المدخلة.',
        errors: details
      });
    }
    
    next();
  };
};

// Login Validation Schema
const loginSchema = Joi.object({
  username: Joi.string().min(3).required().messages({
    'string.empty': 'اسم المستخدم مطلوب.',
    'string.min': 'اسم المستخدم يجب ألا يقل عن 3 أحرف.',
    'any.required': 'اسم المستخدم حقل إجباري.'
  }),
  password: Joi.string().min(4).required().messages({
    'string.empty': 'كلمة المرور مطلوبة.',
    'string.min': 'كلمة المرور يجب ألا تقل عن 4 أحرف.',
    'any.required': 'كلمة المرور حقل إجباري.'
  })
});

// OTP Validation Schema
const otpSchema = Joi.object({
  username: Joi.string().required().messages({
    'string.empty': 'اسم المستخدم مطلوب.',
    'any.required': 'اسم المستخدم حقل إجباري.'
  }),
  otp: Joi.string().length(6).pattern(/^\d+$/).required().messages({
    'string.empty': 'رمز التحقق OTP مطلوب.',
    'string.length': 'رمز التحقق OTP يجب أن يتكون من 6 أرقام.',
    'string.pattern.base': 'رمز التحقق OTP يجب أن يحتوي على أرقام فقط.',
    'any.required': 'رمز التحقق OTP حقل إجباري.'
  })
});

// WhatsApp Webhook Validation Schema
const whatsappWebhookSchema = Joi.object({
  From: Joi.string().required().messages({
    'any.required': 'رقم المرسل (From) مطلوب لتحديد العميل.'
  }),
  Body: Joi.string().required().messages({
    'any.required': 'نص الرسالة (Body) مطلوب.'
  })
});

module.exports = {
  validateLogin: validateBody(loginSchema),
  validateOtp: validateBody(otpSchema),
  validateWhatsappWebhook: validateBody(whatsappWebhookSchema)
};
