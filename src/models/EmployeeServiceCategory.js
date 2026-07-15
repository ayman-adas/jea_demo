const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const EmployeeServiceCategory = sequelize.define('EmployeeServiceCategory', {
  service_category_id: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false
  },
  emp_id: {
    type: DataTypes.STRING,
    primaryKey: true,
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
  tableName: 'EmployeeServiceCategories'
});

module.exports = EmployeeServiceCategory;
