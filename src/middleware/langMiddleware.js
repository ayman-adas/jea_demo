/**
 * Express middleware to detect user language for API requests
 * Sets req.lang to 'en' or 'ar'
 */
const langMiddleware = (req, res, next) => {
  let lang = 'en';

  // 1. Check query parameter e.g., ?lang=ar
  if (req.query?.lang) {
    const queryLang = req.query.lang.toString().trim().toLowerCase();
    if (queryLang === 'ar' || queryLang === 'en') {
      lang = queryLang;
    }
  } else {
    // 2. Check Accept-Language header (e.g., "ar-JO,ar;q=0.9,en-US;q=0.8")
    const acceptLang = req.headers['accept-language'];
    if (acceptLang) {
      const preferred = acceptLang.split(',')[0].trim().toLowerCase();
      if (preferred.startsWith('ar')) {
        lang = 'ar';
      }
    }
  }

  req.lang = lang;
  next();
};

module.exports = langMiddleware;
