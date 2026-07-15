const sequelize = require('../config/database');

const User = require('./User');
const Employee = require('./Employee');
const Customer = require('./Customer');
const Session = require('./Session');
const Message = require('./Message');
const Campaign = require('./Campaign');
const Rating = require('./Rating');
const Ticket = require('./Ticket');
const ServiceCategory = require('./ServiceCategory');
const EmployeeServiceCategory = require('./EmployeeServiceCategory');
const QA = require('./QA');
const Notification = require('./Notification');
const AuditLog = require('./AuditLog');

// ==========================================
// Define Associations (Relationships)
// ==========================================

// 1. User <-> Employee (One-to-One)
User.hasOne(Employee, { foreignKey: 'id', as: 'employee', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Employee.belongsTo(User, { foreignKey: 'id', as: 'user', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// 2. User <-> Customer (One-to-One)
User.hasOne(Customer, { foreignKey: 'member_id', as: 'customer', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Customer.belongsTo(User, { foreignKey: 'member_id', as: 'user', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// 3. User <-> Campaign (One-to-Many)
User.hasMany(Campaign, { foreignKey: 'created_by', as: 'campaigns', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Campaign.belongsTo(User, { foreignKey: 'created_by', as: 'creator', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// 4. Session <-> Message (One-to-Many)
Session.hasMany(Message, { foreignKey: 'session_id', as: 'messages', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Message.belongsTo(Session, { foreignKey: 'session_id', as: 'session', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// 5. Customer <-> Rating (One-to-Many)
Customer.hasMany(Rating, { foreignKey: 'user_id', as: 'ratings', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Rating.belongsTo(Customer, { foreignKey: 'user_id', as: 'customer', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// 6. Customer <-> Ticket (One-to-Many)
Customer.hasMany(Ticket, { foreignKey: 'user_id', as: 'tickets', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Ticket.belongsTo(Customer, { foreignKey: 'user_id', as: 'customer', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// 7. Employee <-> Ticket (One-to-Many)
Employee.hasMany(Ticket, { foreignKey: 'emp_assigned', as: 'assignedTickets', onDelete: 'SET NULL', onUpdate: 'CASCADE' });
Ticket.belongsTo(Employee, { foreignKey: 'emp_assigned', as: 'assignee', onDelete: 'SET NULL', onUpdate: 'CASCADE' });

// 8. Employee <-> Notification (One-to-Many)
Employee.hasMany(Notification, { foreignKey: 'emp_id', as: 'notifications', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Notification.belongsTo(Employee, { foreignKey: 'emp_id', as: 'employee', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// 9. ServiceCategory <-> QA (One-to-Many)
ServiceCategory.hasMany(QA, { foreignKey: 'service_category_id', as: 'qas', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
QA.belongsTo(ServiceCategory, { foreignKey: 'service_category_id', as: 'serviceCategory', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// 10. Employee <-> QA (One-to-Many)
Employee.hasMany(QA, { foreignKey: 'employee_assigned', as: 'assignedQAs', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
QA.belongsTo(Employee, { foreignKey: 'employee_assigned', as: 'assignee', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// 11. Employee <-> ServiceCategory (Many-to-Many via EmployeeServiceCategory)
Employee.belongsToMany(ServiceCategory, {
  through: EmployeeServiceCategory,
  foreignKey: 'emp_id',
  otherKey: 'service_category_id',
  as: 'serviceCategories',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
ServiceCategory.belongsToMany(Employee, {
  through: EmployeeServiceCategory,
  foreignKey: 'service_category_id',
  otherKey: 'emp_id',
  as: 'employees',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

// Also define direct relations for junction table queries
Employee.hasMany(EmployeeServiceCategory, { foreignKey: 'emp_id' });
EmployeeServiceCategory.belongsTo(Employee, { foreignKey: 'emp_id' });
ServiceCategory.hasMany(EmployeeServiceCategory, { foreignKey: 'service_category_id' });
EmployeeServiceCategory.belongsTo(ServiceCategory, { foreignKey: 'service_category_id' });

module.exports = {
  sequelize,
  User,
  Employee,
  Customer,
  Session,
  Message,
  Campaign,
  Rating,
  Ticket,
  ServiceCategory,
  EmployeeServiceCategory,
  QA,
  Notification,
  AuditLog
};
