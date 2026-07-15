const AuditLog = require('../models/AuditLog');
const { auditLogger } = require('../config/logger');

/**
 * Base CRUD Controller Builder
 * Returns explicit controller handlers for a specific Sequelize model
 */
const createBaseController = (Model) => {
  return {
    create: async (req, res, next) => {
      try {
        const item = await Model.create(req.body);

        // Audit Logging
        try {
          if (Model.name !== 'AuditLog') {
            const recordId = String(item[Model.primaryKeyAttribute] || item.id || '');
            const newValues = item.toJSON();
            const ipAddress = req.ip;
            const userId = req.headers['x-user-id'] || null;

            await AuditLog.create({
              model_name: Model.name,
              action: 'CREATE',
              record_id: recordId,
              user_id: userId,
              new_values: newValues,
              ip_address: ipAddress
            });

            auditLogger.info(`Created ${Model.name} record with ID ${recordId}`, {
              model: Model.name,
              action: 'CREATE',
              recordId,
              userId,
              newValues,
              ipAddress
            });
          }
        } catch (auditErr) {
          console.error('Failed to create CREATE audit log:', auditErr.message);
        }

        res.status(201).json({
          success: true,
          data: item
        });
      } catch (err) {
        next(err);
      }
    },

    findAll: async (req, res, next) => {
      try {
        const { limit = 50, offset = 0, ...filters } = req.query;

        const where = {};
        Object.keys(filters).forEach(key => {
          if (Model.rawAttributes[key]) {
            where[key] = filters[key];
          }
        });

        const { count, rows } = await Model.findAndCountAll({
          where,
          limit: Number.parseInt(limit, 10),
          offset: Number.parseInt(offset, 10)
        });

        res.json({
          success: true,
          total: count,
          limit: Number.parseInt(limit, 10),
          offset: Number.parseInt(offset, 10),
          data: rows
        });
      } catch (err) {
        next(err);
      }
    },

    findOne: async (req, res, next) => {
      try {
        const item = await Model.findByPk(req.params.id);
        if (!item) {
          const err = new Error(`Resource not found with ID: ${req.params.id}`);
          err.statusCode = 404;
          throw err;
        }
        res.json({
          success: true,
          data: item
        });
      } catch (err) {
        next(err);
      }
    },

    update: async (req, res, next) => {
      try {
        const item = await Model.findByPk(req.params.id);
        if (!item) {
          const err = new Error(`Resource not found with ID: ${req.params.id}`);
          err.statusCode = 404;
          throw err;
        }

        const oldValues = item.toJSON();
        await item.update(req.body);
        const newValues = item.toJSON();

        // Audit Logging
        try {
          if (Model.name !== 'AuditLog') {
            const recordId = String(item[Model.primaryKeyAttribute] || item.id || '');
            const ipAddress = req.ip;
            const userId = req.headers['x-user-id'] || null;

            await AuditLog.create({
              model_name: Model.name,
              action: 'UPDATE',
              record_id: recordId,
              user_id: userId,
              old_values: oldValues,
              new_values: newValues,
              ip_address: ipAddress
            });

            auditLogger.info(`Updated ${Model.name} record with ID ${recordId}`, {
              model: Model.name,
              action: 'UPDATE',
              recordId,
              userId,
              oldValues,
              newValues,
              ipAddress
            });
          }
        } catch (auditErr) {
          console.error('Failed to create UPDATE audit log:', auditErr.message);
        }

        res.json({
          success: true,
          data: item
        });
      } catch (err) {
        next(err);
      }
    },

    delete: async (req, res, next) => {
      try {
        const item = await Model.findByPk(req.params.id);
        if (!item) {
          const err = new Error(`Resource not found with ID: ${req.params.id}`);
          err.statusCode = 404;
          throw err;
        }

        const oldValues = item.toJSON();
        await item.destroy();

        // Audit Logging
        try {
          if (Model.name !== 'AuditLog') {
            const recordId = String(item[Model.primaryKeyAttribute] || item.id || '');
            const ipAddress = req.ip;
            const userId = req.headers['x-user-id'] || null;

            await AuditLog.create({
              model_name: Model.name,
              action: 'DELETE',
              record_id: recordId,
              user_id: userId,
              old_values: oldValues,
              ip_address: ipAddress
            });

            auditLogger.info(`Deleted ${Model.name} record with ID ${recordId}`, {
              model: Model.name,
              action: 'DELETE',
              recordId,
              userId,
              oldValues,
              ipAddress
            });
          }
        } catch (auditErr) {
          console.error('Failed to create DELETE audit log:', auditErr.message);
        }

        res.json({
          success: true,
          message: 'Resource deleted successfully'
        });
      } catch (err) {
        next(err);
      }
    }
  };
};

module.exports = createBaseController;
