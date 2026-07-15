const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');

router.post('/', sessionController.create);
router.get('/', sessionController.findAll);
router.get('/:id', sessionController.findOne);
router.put('/:id', sessionController.update);
router.delete('/:id', sessionController.delete);

module.exports = router;
