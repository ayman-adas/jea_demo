const { Ticket } = require('../models');
const createBaseController = require('./baseController');

module.exports = createBaseController(Ticket);
