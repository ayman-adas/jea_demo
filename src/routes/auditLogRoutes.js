const express = require('express');
const router = express.Router();
const auditLogController = require('../controllers/auditLogController');

router.get('/', auditLogController.findAll);
router.get('/:id', auditLogController.findOne);

module.exports = router;
