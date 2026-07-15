const { User } = require('../models');
const createBaseController = require('./baseController');

module.exports = createBaseController(User);
