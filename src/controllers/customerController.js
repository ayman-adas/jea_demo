const { Customer } = require('../models');
const createBaseController = require('./baseController');

module.exports = createBaseController(Customer);
