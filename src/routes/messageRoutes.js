const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');

router.post('/', messageController.create);
router.get('/', messageController.findAll);
router.get('/:id', messageController.findOne);
router.put('/:id', messageController.update);
router.delete('/:id', messageController.delete);

module.exports = router;
