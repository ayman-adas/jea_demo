const express = require('express');
const router = express.Router();
const adminCtrl = require('../controllers/adminController');
const { authenticate, requireAdmin } = require('../middleware/authMiddleware');

const { authLimiter } = require('../middleware/rateLimiters');
const { validateLogin, validateOtp } = require('../middleware/validationMiddleware');

// ── Auth (no auth required) ───────────────────────────────────────────────
router.post('/auth/login', authLimiter, validateLogin, adminCtrl.login);
router.post('/auth/verify-otp', authLimiter, validateOtp, adminCtrl.verifyOtp);
router.post('/auth/refresh-token', authLimiter, adminCtrl.refreshToken);

// ── Protected admin routes ────────────────────────────────────────────────
router.use(authenticate);

router.get('/auth/me', adminCtrl.me);
router.get('/dashboard', adminCtrl.getDashboardStats);

// Sessions (inbox conversations)
router.get('/sessions', adminCtrl.getAdminSessions);
router.get('/sessions/:sessionId/messages', adminCtrl.getSessionMessages);
router.patch('/sessions/:sessionId/handover', adminCtrl.setHandover);
router.patch('/sessions/:sessionId/status', adminCtrl.setSessionStatus);
router.post('/sessions/:sessionId/reply', adminCtrl.sendHandoverReply);

// Tickets Management (Employee filtered / Admin global)
router.get('/tickets', adminCtrl.getAdminTickets);
router.patch('/tickets/:ticketId', adminCtrl.updateAdminTicket);

module.exports = router;
