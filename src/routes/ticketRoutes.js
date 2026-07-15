const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');

router.post('/', ticketController.create);
router.get('/', ticketController.findAll);
router.get('/:id', ticketController.findOne);
router.put('/:id', ticketController.update);
router.delete('/:id', ticketController.delete);

module.exports = router;
