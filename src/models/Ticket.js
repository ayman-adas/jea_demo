const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Ticket = sequelize.define('Ticket', {
  ticket_id: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false
  },
  ticket_priority: {
    type: DataTypes.ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT'),
    allowNull: false,
    defaultValue: 'LOW'
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  // Spelled 'ai_confedance' in the ERD
  ai_confedance: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0.0
  },
  user_id: {
    type: DataTypes.STRING,
    allowNull: false
  },
  emp_assigned: {
    type: DataTypes.STRING,
    allowNull: true
  },
  start_time: {
    type: DataTypes.DATE,
    allowNull: true
  },
  end_time: {
    type: DataTypes.DATE,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'),
    allowNull: false,
    defaultValue: 'OPEN'
  }
}, {
  timestamps: true,
  paranoid: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  deletedAt: 'deleted_at',
  tableName: 'Tickets'
});

module.exports = Ticket;
