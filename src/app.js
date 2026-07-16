const express = require("express");
const swaggerUi = require("swagger-ui-express");
const swaggerDocument = require("./swagger.json");
const apiRoutes = require("./routes/api");
const adminRoutes = require("./routes/adminRoutes");
const errorHandler = require("./middleware/errorHandler");
const logMiddleware = require("./middleware/logMiddleware");
const langMiddleware = require("./middleware/langMiddleware");

const helmet = require("helmet");
const path = require("node:path");

const app = express();

// Secure HTTP Headers (Helmet) with permissive CSP for Tailwind / Lucide CDNs

// Serve uploads statically for Twilio access
app.use(
  "/public_uploads",
  express.static(path.join(__dirname, "..", "tmp_uploads")),
);

// Serve admin panel static files
app.use("/admin", express.static(path.join(__dirname, "..", "public")));

// CORS & Preflight middleware
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept-Language");
  
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(logMiddleware);
app.use(langMiddleware);

// Swagger UI Route
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Admin API Routes (auth + admin panel endpoints)
app.use("/api/admin", adminRoutes);

// API Routes (WhatsApp webhook + send)
app.use("/api", apiRoutes);

// Dedicated CRUD Service Routes
app.use("/api/v1/users", require("./routes/userRoutes"));
app.use("/api/v1/employees", require("./routes/employeeRoutes"));
app.use("/api/v1/customers", require("./routes/customerRoutes"));
app.use("/api/v1/sessions", require("./routes/sessionRoutes"));
app.use("/api/v1/messages", require("./routes/messageRoutes"));
app.use("/api/v1/campaigns", require("./routes/campaignRoutes"));
app.use("/api/v1/ratings", require("./routes/ratingRoutes"));
app.use("/api/v1/tickets", require("./routes/ticketRoutes"));
app.use(
  "/api/v1/service-categories",
  require("./routes/serviceCategoryRoutes"),
);
app.use(
  "/api/v1/employee-service-categories",
  require("./routes/employeeServiceCategoryRoutes"),
);
app.use("/api/v1/qas", require("./routes/qaRoutes"));
app.use("/api/v1/notifications", require("./routes/notificationRoutes"));
app.use("/api/v1/audit-logs", require("./routes/auditLogRoutes"));
app.use("/api/v1/upload", require("./routes/uploadRoutes"));

// Root route redirect/status
app.get("/", (req, res) => {
  res.json({
    message: "Welcome to the JEA Demo Express Backend API",
    status: "healthy",
    documentation: "/api-docs",
  });
});

// Error handling middleware
app.use(errorHandler);

module.exports = app;
