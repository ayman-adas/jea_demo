const winston = require('winston');
const path = require('node:path');
const fs = require('node:fs');

const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// 1. General Logger Formats
const errorStackFormat = winston.format(info => {
  if (info instanceof Error) {
    return {
      ...info,
      message: info.message,
      stack: info.stack
    };
  }
  return info;
});

const defaultFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errorStackFormat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(info => {
    const levelStr = String(info.level);
    const timestampStr = typeof info.timestamp === 'string' ? info.timestamp : JSON.stringify(info.timestamp);
    const messageStr = typeof info.message === 'string' ? info.message : JSON.stringify(info.message);
    
    // Extract remaining metadata keys
    const meta = { ...info };
    delete meta.level;
    delete meta.timestamp;
    delete meta.message;
    
    const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestampStr}] ${levelStr}: ${messageStr}${metaString}`;
  })
);

// 2. Default General Logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: defaultFormat,
  transports: [
    new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(logDir, 'combined.log') })
  ]
});

// Load Console transport in development/local
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat
  }));
}

// 3. Dedicated Audit Logger
const auditLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: path.join(logDir, 'audit.log') })
  ]
});

// Also print audit logs to console in development
if (process.env.NODE_ENV !== 'production') {
  auditLogger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(info => {
        const levelStr = String(info.level);
        const timestampStr = typeof info.timestamp === 'string' ? info.timestamp : JSON.stringify(info.timestamp);
        const messageStr = typeof info.message === 'string' ? info.message : JSON.stringify(info.message);
        
        const meta = { ...info };
        delete meta.level;
        delete meta.timestamp;
        delete meta.message;
        
        return `[${timestampStr}] ${levelStr} [AUDIT]: ${messageStr} ${JSON.stringify(meta)}`;
      })
    )
  }));
}

module.exports = {
  logger,
  auditLogger
};
