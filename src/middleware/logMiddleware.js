const { logger } = require('../config/logger');

// Sensitive fields to redact from logs
const SENSITIVE_FIELDS = new Set(['password', 'access_token', 'refresh_token', 'token', 'auth_token']);

const redactSensitiveData = (data) => {
  if (!data) return data;
  if (typeof data !== 'object') return data;

  const copy = { ...data };
  Object.keys(copy).forEach(key => {
    if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
      copy[key] = '[REDACTED]';
    } else if (typeof copy[key] === 'object' && copy[key] !== null) {
      copy[key] = redactSensitiveData(copy[key]);
    }
  });
  return copy;
};

const logMiddleware = (req, res, next) => {
  const start = Date.now();
  const { method, url, ip } = req;
  const userAgent = req.headers['user-agent'] || '';

  // Log incoming request
  logger.info(`Incoming request: ${method} ${url}`, {
    method,
    url,
    ip,
    userAgent,
    body: redactSensitiveData(req.body)
  });

  // Intercept response finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;

    const logData = {
      method,
      url,
      statusCode,
      duration: `${duration}ms`,
      ip
    };

    if (statusCode >= 400) {
      logger.error(`Request failed: ${method} ${url} - Status ${statusCode} (${duration}ms)`, logData);
    } else {
      logger.info(`Request completed: ${method} ${url} - Status ${statusCode} (${duration}ms)`, logData);
    }
  });

  next();
};

module.exports = logMiddleware;
