const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');

router.post('/', customerController.create);
router.get('/', customerController.findAll);
router.get('/:id', customerController.findOne);
router.put('/:id', customerController.update);
router.delete('/:id', customerController.delete);

module.exports = router;
