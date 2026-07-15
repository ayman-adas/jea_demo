const express = require('express');
const router = express.Router();
const employeeController = require('../controllers/employeeController');

router.post('/', employeeController.create);
router.get('/', employeeController.findAll);
router.get('/:id', employeeController.findOne);
router.put('/:id', employeeController.update);
router.delete('/:id', employeeController.delete);

module.exports = router;
