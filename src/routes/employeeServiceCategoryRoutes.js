const express = require('express');
const router = express.Router();
const employeeServiceCategoryController = require('../controllers/employeeServiceCategoryController');

router.post('/', employeeServiceCategoryController.create);
router.get('/', employeeServiceCategoryController.findAll);
router.get('/:id', employeeServiceCategoryController.findOne);
router.put('/:id', employeeServiceCategoryController.update);
router.delete('/:id', employeeServiceCategoryController.delete);

module.exports = router;
