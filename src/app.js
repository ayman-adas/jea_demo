const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');
const apiRoutes = require('./routes/api');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger UI Route
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// API Routes
app.use('/api', apiRoutes);

// Root route redirect/status
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to the JEA Demo Express Backend API',
    status: 'healthy',
    documentation: '/api-docs'
  });
});

// Error handling middleware
app.use(errorHandler);

module.exports = app;
