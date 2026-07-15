const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');

router.post('/', notificationController.create);
router.get('/', notificationController.findAll);
router.get('/:id', notificationController.findOne);
router.put('/:id', notificationController.update);
router.delete('/:id', notificationController.delete);

module.exports = router;
