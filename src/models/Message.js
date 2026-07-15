const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Message = sequelize.define('Message', {
  message_id: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false
  },
  session_id: {
    type: DataTypes.STRING,
    allowNull: false
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  from: {
    type: DataTypes.STRING,
    allowNull: false
  },
  message_type: {
    type: DataTypes.ENUM('TEXT', 'IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO'),
    allowNull: false,
    defaultValue: 'TEXT'
  },
  status: {
    type: DataTypes.ENUM('SENT', 'DELIVERED', 'READ', 'FAILED'),
    allowNull: false,
    defaultValue: 'SENT'
  },
  // As per ERD: these are varchar
  created_at: {
    type: DataTypes.STRING,
    allowNull: false
  },
  updated_at: {
    type: DataTypes.STRING,
    allowNull: false
  },
  deleted_at: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  timestamps: false, // Disabling automatic timestamps since columns are varchar
  tableName: 'Messages'
});

module.exports = Message;
