const express = require('express');
const router = express.Router();
const ratingController = require('../controllers/ratingController');

router.post('/', ratingController.create);
router.get('/', ratingController.findAll);
router.get('/:id', ratingController.findOne);
router.put('/:id', ratingController.update);
router.delete('/:id', ratingController.delete);

module.exports = router;
