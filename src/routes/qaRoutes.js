const express = require('express');
const router = express.Router();
const qaController = require('../controllers/qaController');

router.post('/', qaController.create);
router.get('/', qaController.findAll);
router.get('/:id', qaController.findOne);
router.put('/:id', qaController.update);
router.delete('/:id', qaController.delete);

module.exports = router;
