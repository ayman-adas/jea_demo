const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const QA = sequelize.define('QA', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false
  },
  service_category_id: {
    type: DataTypes.STRING,
    allowNull: false
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  content_type: {
    type: DataTypes.ENUM('TEXT', 'HTML', 'MARKDOWN'),
    allowNull: false,
    defaultValue: 'TEXT'
  },
  employee_assigned: {
    type: DataTypes.STRING,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('ACTIVE', 'INACTIVE'),
    allowNull: false,
    defaultValue: 'ACTIVE'
  }
}, {
  timestamps: true,
  paranoid: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  deletedAt: 'deleted_at',
  tableName: 'QA' // Using QA as the database table name
});

module.exports = QA;
