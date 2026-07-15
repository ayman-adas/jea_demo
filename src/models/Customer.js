const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Customer = sequelize.define('Customer', {
  member_id: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('MEMBER', 'GUEST', 'VIP'),
    allowNull: false,
    defaultValue: 'MEMBER'
  },
  access_token: {
    type: DataTypes.STRING,
    allowNull: true
  },
  refresh_token: {
    type: DataTypes.STRING,
    allowNull: true
  },
  gender: {
    type: DataTypes.ENUM('MALE', 'FEMALE', 'OTHER'),
    allowNull: false
  }
}, {
  timestamps: false,
  tableName: 'Customers'
});

module.exports = Customer;
