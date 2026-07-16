const { AuditLog } = require('../models');
const createBaseController = require('./baseController');

const base = createBaseController(AuditLog);

// Expose only read operations for security/integrity of the audit trail
module.exports = {
  findAll: base.findAll,
  findOne: base.findOne
};
