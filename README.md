# JEA Digital Assistant — Demo Platform (Express + MySQL + Admin Dashboard)

Welcome to the **Jordan Engineers Association (JEA)** Digital Assistant demo workspace. This repository contains the complete Express-based API backend integrated with a MySQL database and a built-in interactive single-page Admin Panel.

---

## 🛠️ Technology Stack
- **Backend:** Node.js, Express.js
- **Database ORM:** Sequelize (MySQL/MariaDB)
- **WhatsApp Channel Integration:** Twilio WhatsApp Messaging API
- **Security & Session Management:** JSON Web Token (JWT) with Two-Step OTP verification (Isolated login/verify endpoints)
- **Documentation:** Swagger UI API docs
- **Admin Panel UI:** HTML5, Tailwind CSS (via CDN), Lucide Icons, Vanilla JavaScript

---

## 📁 Key Project Structure
```text
jea_demo/
├── public/                 # Static admin panel files
│   └── index.html          # Interactive RTL single-page dashboard & inbox chat UI
├── src/
│   ├── config/             # Database connection, localization strings, Twilio configs
│   ├── controllers/        # REST CRUD controllers & whatsapp webhook orchestrator
│   ├── middleware/         # JWT verification, logger, language detection, error handlers
│   ├── models/             # 14 Sequelize database models (Sessions, Messages, Users, etc.)
│   ├── routes/             # API routing (standard endpoints & /api/admin)
│   └── app.js              # Express app setup and middleware routing registry
├── database/
│   └── schema.sql          # Base database SQL schema structures
├── index.js                # Server entry point
└── .env                    # System configurations (ignored in git)
```

---

## 🚀 Installation & Setup

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Configure Environment Variables:**
   Create a `.env` file in the root directory (refer to `.env.example`):
   ```env
   PORT=3000
   
   # Twilio Credentials
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_AUTH_TOKEN=...
   TWILIO_WHATSAPP_NUMBER=whatsapp:+...
   
   # Database Configurations
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=root
   DB_NAME=jea_demo
   DB_PORT=3306
   
   # Twilio List Picker Templates
   GREETING_TEMPLATE_SID_EN=HX...
   GREETING_TEMPLATE_SID_AR=HX...
   
   # Admin Credentials & 2FA OTP
   JWT_SECRET=jea-admin-super-secret-2026
   JWT_EXPIRES_IN=8h
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=admin123
   ADMIN_OTP=123456
   ```

3. **Database Migration:**
   Make sure you have your MySQL database created and updated using the schema inside `database/schema.sql`.

4. **Start Development Server:**
   ```bash
   npm run dev
   ```

---

## 💻 Accessing features

### 1. Interactive Admin Panel Dashboard
Navigate to: **[http://localhost:3000/admin](http://localhost:3000/admin)**
* **Step 1:** Enter Username (`admin`) and Password (`admin123`). Click **متابعة**.
* **Step 2:** Enter OTP Code (`123456`). Click **تسجيل الدخول**.
* **Features:**
  - View real-time active conversations and customer roles.
  - Review complete chronological chat message logs (bot responses + templates).
  - Direct Live Chat: Type a message and send it directly via Twilio to the engineer's WhatsApp.
  - Human Handoff Control: Toggle conversation between **Human (بشري)** and **Bot (تلقائي)** modes.

### 2. Swagger API Documentation
Detailed API structure and interactive request tester:
* URL: **[http://localhost:3000/api-docs](http://localhost:3000/api-docs)**

---

## 🔐 Isolated OTP Two-Step Login API Flow

The backend isolates credentials checking from token creation for maximum security:

1. **Step 1: Validate Credentials**
   - **Path:** `POST /api/admin/auth/login`
   - **Body:** `{ "username": "admin", "password": "admin123" }`
   - **Response:** `{ "success": true, "requireOtp": true, "message": "Credentials valid. OTP required." }`

2. **Step 2: Verify OTP and Start Session**
   - **Path:** `POST /api/admin/auth/verify-otp`
   - **Body:** `{ "username": "admin", "otp": "123456" }`
   - **Response:** Returns JWT token and User session profiles.
