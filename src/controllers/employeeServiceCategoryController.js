const { EmployeeServiceCategory } = require('../models');
const createBaseController = require('./baseController');

module.exports = createBaseController(EmployeeServiceCategory);
