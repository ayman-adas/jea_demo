const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Session = sequelize.define('Session', {
  session_id: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false
  },
  is_handover: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  status: {
    type: DataTypes.ENUM('OPEN', 'CLOSED', 'PENDING'),
    allowNull: false,
    defaultValue: 'OPEN'
  }
}, {
  timestamps: true,
  paranoid: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  deletedAt: 'deleted_at',
  tableName: 'Sessions'
});

module.exports = Session;
