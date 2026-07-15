const { Employee } = require('../models');
const createBaseController = require('./baseController');

module.exports = createBaseController(Employee);
