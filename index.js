// Trigger reload
require('dotenv').config();
const app = require('./src/app');

const mysql = require('mysql2/promise');
const { sequelize } = require('./src/models');

const PORT = process.env.PORT || 3000;

// Setup database creation and ORM initialization
const initialize = async () => {
  try {
    console.log('Verifying database existence...');
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number.parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD
    });

    const dbName = process.env.DB_NAME || 'jea_demo';
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
    await connection.end();
    console.log(`Database "${dbName}" verified/created successfully.`);

    // Authenticate and sync with database
    await sequelize.authenticate();
    console.log('Database connection established successfully.');

    await sequelize.sync({ force: false });
    console.log('Database models synchronized.');

    // Start server listening
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Initialization failed:', err);
    process.exit(1);
  }
};

initialize();
