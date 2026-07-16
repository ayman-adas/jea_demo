const express = require('express');
const router = express.Router();
const adminCtrl = require('../controllers/adminController');
const { authenticate, requireAdmin } = require('../middleware/authMiddleware');

// ── Auth (no auth required) ───────────────────────────────────────────────
router.post('/auth/login', adminCtrl.login);
router.post('/auth/verify-otp', adminCtrl.verifyOtp);

// ── Protected admin routes ────────────────────────────────────────────────
router.use(authenticate);

router.get('/auth/me', adminCtrl.me);
router.get('/dashboard', adminCtrl.getDashboardStats);

// Sessions (inbox conversations)
router.get('/sessions', adminCtrl.getAdminSessions);
router.get('/sessions/:sessionId/messages', adminCtrl.getSessionMessages);
router.patch('/sessions/:sessionId/handover', adminCtrl.setHandover);
router.patch('/sessions/:sessionId/status', adminCtrl.setSessionStatus);

module.exports = router;
