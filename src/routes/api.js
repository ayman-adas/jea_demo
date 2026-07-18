const express = require('express');
const router = express.Router();
const apiController = require('../controllers/apiController');
const whatsappController = require('../controllers/whatsappController');

const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const tempUploadDir = path.join(__dirname, '..', '..', 'tmp_uploads');
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempUploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + crypto.randomUUID();
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

router.get('/', apiController.getApiIndex);
router.get('/status', apiController.getStatus);
router.get('/health', apiController.getHealth);

const { whatsappMinutelyLimiter, whatsappDailyLimiter } = require('../middleware/rateLimiters');
const { validateWhatsappWebhook } = require('../middleware/validationMiddleware');

// Queue monitoring (no auth for internal monitoring; add auth middleware if needed)
router.get('/queue/status', whatsappController.getQueueStatus);

// Twilio WhatsApp routes
router.post('/whatsapp/send', upload.any(), whatsappController.sendWhatsApp);
router.post(
  '/whatsapp/webhook',
  whatsappMinutelyLimiter,
  whatsappDailyLimiter,
  validateWhatsappWebhook,
  whatsappController.receiveWebhookQueued   // ← Queued entry point (returns 200 immediately)
);

// Payment Portal Submission Route
router.post('/whatsapp/payment/submit', whatsappController.submitPayment);

module.exports = router;


