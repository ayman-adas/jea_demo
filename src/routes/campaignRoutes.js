const express = require('express');
const router = express.Router();
const campaignController = require('../controllers/campaignController');

router.post('/', campaignController.create);
router.get('/', campaignController.findAll);
router.get('/:id', campaignController.findOne);
router.put('/:id', campaignController.update);
router.delete('/:id', campaignController.delete);

module.exports = router;
