const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'jea-demo-secret-key-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (JWT_SECRET + '-refresh-token-secret-key-2026');
const JWT_ACCESS_EXPIRES_IN = '1h'; // 1 hour access token
const JWT_REFRESH_EXPIRES_IN = '7d'; // 7 days refresh token

/**
 * Generate a JWT access token for a user
 */
const generateAccessToken = (user) => {
  return jwt.sign(
    {
      user_id: user.user_id,
      name: user.name,
      user_type: user.user_type,
      status: user.status
    },
    JWT_SECRET,
    { expiresIn: JWT_ACCESS_EXPIRES_IN }
  );
};

/**
 * Generate a JWT refresh token for a user
 */
const generateRefreshToken = (user) => {
  return jwt.sign(
    {
      user_id: user.user_id
    },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN }
  );
};

/**
 * Generate a JWT token for a user (backward compatibility)
 */
const generateToken = (user) => {
  return generateAccessToken(user);
};

/**
 * Middleware: Verify Bearer JWT token
 */
const authenticate = (req, res, next) => {
  if (req.method === 'OPTIONS') {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Missing or invalid authorization header.' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, code: 'INVALID_TOKEN', message: 'Token is invalid or expired.' });
  }
};

/**
 * Middleware: Require admin or employee role
 */
const requireAdmin = (req, res, next) => {
  if (!req.user || !['ADMIN', 'EMPLOYEE', 'AGENT'].includes(req.user.user_type)) {
    return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'Insufficient permissions.' });
  }
  next();
};

module.exports = { 
  generateToken, 
  generateAccessToken, 
  generateRefreshToken, 
  authenticate, 
  requireAdmin,
  JWT_REFRESH_SECRET: JWT_REFRESH_SECRET
};
