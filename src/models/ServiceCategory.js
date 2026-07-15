const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ServiceCategory = sequelize.define('ServiceCategory', {
  service_id: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false
  },
  service_name: {
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
  tableName: 'ServiceCategories'
});

module.exports = ServiceCategory;
