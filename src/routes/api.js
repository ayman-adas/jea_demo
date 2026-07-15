const express = require('express');
const router = express.Router();
const apiController = require('../controllers/apiController');
const whatsappController = require('../controllers/whatsappController');

router.get('/', apiController.getApiIndex);
router.get('/status', apiController.getStatus);
router.get('/health', apiController.getHealth);

// Twilio WhatsApp routes
router.post('/whatsapp/send', whatsappController.sendWhatsApp);
router.post('/whatsapp/webhook', whatsappController.receiveWebhook);

module.exports = router;
