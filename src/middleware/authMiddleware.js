const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'jea-demo-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

/**
 * Generate a JWT token for a user
 */
const generateToken = (user) => {
  return jwt.sign(
    {
      user_id: user.user_id,
      name: user.name,
      user_type: user.user_type,
      status: user.status
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
};

/**
 * Middleware: Verify Bearer JWT token
 */
const authenticate = (req, res, next) => {
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

module.exports = { generateToken, authenticate, requireAdmin };
