const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Employee = sequelize.define('Employee', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('SUPPORT', 'MANAGER', 'ADMIN', 'AGENT'),
    allowNull: false
  }
}, {
  timestamps: false,
  tableName: 'Employees'
});

module.exports = Employee;
