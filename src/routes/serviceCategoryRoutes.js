const express = require('express');
const router = express.Router();
const serviceCategoryController = require('../controllers/serviceCategoryController');

router.post('/', serviceCategoryController.create);
router.get('/', serviceCategoryController.findAll);
router.get('/:id', serviceCategoryController.findOne);
router.put('/:id', serviceCategoryController.update);
router.delete('/:id', serviceCategoryController.delete);

module.exports = router;
