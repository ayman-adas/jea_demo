const { User, Session, Message, Ticket, Customer } = require('../models');
const { generateAccessToken, generateRefreshToken, JWT_REFRESH_SECRET } = require('../middleware/authMiddleware');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');

/**
 * POST /api/auth/login
 * Body: { username: string, password: string }
 * Simple auth: matches username against User.name + password against JWT_SECRET env
 * (No bcrypt since User model has no password field — uses env-based admin credentials)
 */
exports.login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'username and password are required.' });
    }

    // Check credentials first
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

    if (username === adminUsername && password === adminPassword) {
      return res.json({
        success: true,
        requireOtp: true,
        message: 'Credentials valid. OTP required.'
      });
    }

    // Check database users
    const user = await User.findOne({
      where: {
        [Op.or]: [
          { name: username },
          { user_id: username }
        ],
        user_type: { [Op.in]: ['ADMIN', 'EMPLOYEE', 'AGENT'] },
        status: 'ACTIVE'
      }
    });

    if (!user || password !== adminPassword) {
      return res.status(401).json({ success: false, code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' });
    }

    return res.json({
      success: true,
      requireOtp: true,
      message: 'Credentials valid. OTP required.'
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/auth/verify-otp
 * Body: { username: string, otp: string }
 */
exports.verifyOtp = async (req, res, next) => {
  try {
    const { username, otp } = req.body;

    if (!username || !otp) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'username and otp are required.' });
    }

    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    let targetUser = null;

    if (username === adminUsername) {
      targetUser = {
        user_id: 'admin',
        name: adminUsername,
        user_type: 'ADMIN',
        status: 'ACTIVE'
      };
    } else {
      const user = await User.findOne({
        where: {
          [Op.or]: [
            { name: username },
            { user_id: username }
          ],
          user_type: { [Op.in]: ['ADMIN', 'EMPLOYEE', 'AGENT'] },
          status: 'ACTIVE'
        }
      });

      if (!user) {
        return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: 'User not found.' });
      }

      targetUser = {
        user_id: user.user_id,
        name: user.name,
        user_type: user.user_type,
        status: user.status
      };
    }

    // Verify OTP code
    const requiredOtp = process.env.ADMIN_OTP || '123456';
    if (otp !== requiredOtp) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_OTP',
        message: 'رمز التحقق OTP غير صحيح.'
      });
    }

    // Issue JWT access and refresh tokens on successful verification
    const accessToken = generateAccessToken(targetUser);
    const refreshToken = generateRefreshToken(targetUser);
    return res.json({
      success: true,
      data: {
        token: accessToken, // for backward compatibility
        accessToken,
        refreshToken,
        user: targetUser
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/auth/refresh-token
 * Body: { refreshToken: string }
 * Exchanges a valid refresh token for a new set of access/refresh tokens
 */
exports.refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        code: 'REFRESH_TOKEN_REQUIRED',
        message: 'Refresh token is required.'
      });
    }

    try {
      const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);

      // Verify the user is still active in the database
      const user = await User.findByPk(decoded.user_id);
      if (!user || user.status !== 'ACTIVE') {
        return res.status(403).json({
          success: false,
          code: 'USER_INACTIVE',
          message: 'User is inactive or not found.'
        });
      }

      const targetUser = {
        user_id: user.user_id,
        name: user.name,
        user_type: user.user_type,
        status: user.status
      };

      const newAccessToken = generateAccessToken(targetUser);
      const newRefreshToken = generateRefreshToken(targetUser);

      return res.json({
        success: true,
        data: {
          token: newAccessToken, // backward compatibility
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          user: targetUser
        }
      });
    } catch (jwtErr) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_REFRESH_TOKEN',
        message: 'رمز تجديد الجلسة غير صالح أو منتهي الصلاحية.'
      });
    }
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/auth/me
 * Returns the current authenticated user
 */
exports.me = (req, res) => {
  res.json({ success: true, data: req.user });
};

/**
 * GET /api/admin/dashboard
 * Returns high-level stats for the admin dashboard
 */
exports.getDashboardStats = async (req, res, next) => {
  try {
    const [
      openSessions,
      closedSessions,
      totalMessages,
      openTickets,
      resolvedTickets,
      totalCustomers,
      handoverSessions,
      recentMessages
    ] = await Promise.all([
      Session.count({ where: { status: 'OPEN' } }),
      Session.count({ where: { status: 'CLOSED' } }),
      Message.count(),
      Ticket.count({ where: { status: { [Op.in]: ['OPEN', 'IN_PROGRESS'] } } }),
      Ticket.count({ where: { status: { [Op.in]: ['RESOLVED', 'CLOSED'] } } }),
      Customer.count(),
      Session.count({ where: { status: 'OPEN', is_handover: true } }),
      Message.findAll({
        order: [['created_at', 'DESC']],
        limit: 5
      })
    ]);

    res.json({
      success: true,
      data: {
        sessions: {
          open: openSessions,
          closed: closedSessions,
          handover: handoverSessions,
          total: openSessions + closedSessions
        },
        tickets: {
          open: openTickets,
          resolved: resolvedTickets,
          total: openTickets + resolvedTickets
        },
        customers: {
          total: totalCustomers
        },
        messages: {
          total: totalMessages,
          recent: recentMessages
        }
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/sessions
 * Returns paginated sessions with latest message and customer info
 */
exports.getAdminSessions = async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page) || 1);
    const limit = Math.min(50, Number.parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const status = req.query.status;
    const handover = req.query.handover;

    const where = {};
    if (status) where.status = status.toUpperCase();
    if (handover !== undefined) where.is_handover = handover === 'true';

    const { count, rows: sessions } = await Session.findAndCountAll({
      where,
      limit,
      offset,
      order: [['updated_at', 'DESC']]
    });

    // Fetch customers by phone with robust prefix normalization (+ / 00)
    const rawPhones = sessions.map(s => s.session_id);
    const normalizedPhones = rawPhones.map(p => p.replace(/^\+|^00/, '').trim());
    
    const customers = await Customer.findAll({
      where: {
        [Op.or]: [
          { phone: rawPhones },
          { phone: normalizedPhones },
          { phone: normalizedPhones.map(p => '+' + p) }
        ]
      },
      include: [{ model: require('../models').User, as: 'user' }]
    });

    const customerByPhone = {};
    for (const c of customers) {
      const norm = c.phone.replace(/^\+|^00/, '').trim();
      customerByPhone[norm] = c;
    }

    // Fetch latest message for each session
    const sessionIds = sessions.map(s => s.session_id);
    const latestMessages = await Message.findAll({
      where: { session_id: sessionIds },
      order: [['created_at', 'DESC']]
    });
    const latestBySession = {};
    for (const msg of latestMessages) {
      if (!latestBySession[msg.session_id]) {
        latestBySession[msg.session_id] = msg;
      }
    }

    const data = sessions.map(session => {
      const normSessionPhone = session.session_id.replace(/^\+|^00/, '').trim();
      const customer = customerByPhone[normSessionPhone];
      const latestMsg = latestBySession[session.session_id];
      return {
        id: session.session_id,
        phone: session.session_id,
        status: session.status,
        is_handover: session.is_handover,
        customer_name: customer?.user?.name || session.session_id,
        customer_role: customer?.role || 'GUEST',
        last_message: latestMsg?.content || '',
        last_message_from: latestMsg?.from || '',
        last_message_type: latestMsg?.message_type || 'TEXT',
        last_message_at: latestMsg?.created_at || session.updated_at,
        created_at: session.created_at,
        updated_at: session.updated_at
      };
    });

    res.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/sessions/:sessionId/messages
 * Returns all messages for a conversation session
 */
exports.getSessionMessages = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 100);
    const offset = (page - 1) * limit;

    const session = await Session.findByPk(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, code: 'SESSION_NOT_FOUND', message: 'Session not found.' });
    }

    const { count, rows: messages } = await Message.findAndCountAll({
      where: { session_id: sessionId },
      order: [['created_at', 'ASC']],
      limit,
      offset
    });

    res.json({
      success: true,
      data: messages.map(m => ({
        id: m.message_id,
        session_id: m.session_id,
        content: m.content,
        from: m.from,
        message_type: m.message_type,
        status: m.status,
        direction: m.from === 'SERVER' ? 'outbound' : 'inbound',
        created_at: m.created_at
      })),
      pagination: { page, limit, total: count, pages: Math.ceil(count / limit) }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/admin/sessions/:sessionId/handover
 * Toggle handover (human/bot mode) for a session
 */
exports.setHandover = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { is_handover } = req.body;

    const session = await Session.findByPk(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, code: 'SESSION_NOT_FOUND', message: 'Session not found.' });
    }

    await session.update({ is_handover: Boolean(is_handover) });
    res.json({ success: true, data: session });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/admin/sessions/:sessionId/status
 * Close or reopen a session
 */
exports.setSessionStatus = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { status } = req.body;

    if (!['OPEN', 'CLOSED', 'PENDING'].includes(status)) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'status must be OPEN, CLOSED, or PENDING.' });
    }

    const session = await Session.findByPk(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, code: 'SESSION_NOT_FOUND', message: 'Session not found.' });
    }

    await session.update({ status });
    res.json({ success: true, data: session });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/tickets
 * Returns a paginated list of support tickets.
 * If the user role is not ADMIN, it filters and returns only tickets assigned to the logged-in employee/agent.
 */
exports.getAdminTickets = async (req, res, next) => {
  try {
    const { user_id, user_type } = req.user;
    const { status, limit = 50, offset = 0 } = req.query;

    const where = {};
    
    // If not ADMIN, filter by assigned employee ID
    if (user_type !== 'ADMIN') {
      where.emp_assigned = user_id;
    }

    if (status) {
      where.status = status;
    }

    const { count, rows } = await Ticket.findAndCountAll({
      where,
      limit: Number.parseInt(limit, 10),
      offset: Number.parseInt(offset, 10),
      order: [['created_at', 'DESC']],
      include: [
        { model: Customer, as: 'customer', attributes: ['phone', 'role', 'gender'] }
      ]
    });

    return res.json({
      success: true,
      total: count,
      limit: Number.parseInt(limit, 10),
      offset: Number.parseInt(offset, 10),
      data: rows
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/admin/tickets/:ticketId
 * Updates status, priority, or assignment for a ticket.
 * If user is not ADMIN, they can only update a ticket assigned to them, and cannot assign it to someone else.
 */
exports.updateAdminTicket = async (req, res, next) => {
  try {
    const { user_id, user_type } = req.user;
    const { ticketId } = req.params;
    const { status, ticket_priority, emp_assigned } = req.body;

    const ticket = await Ticket.findByPk(ticketId);
    if (!ticket) {
      return res.status(404).json({ success: false, code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' });
    }

    // Permission check: Employees/Agents can only update tickets assigned to them
    if (user_type !== 'ADMIN' && ticket.emp_assigned !== user_id) {
      return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'You can only manage tickets assigned to you.' });
    }

    const updateData = {};
    if (status) updateData.status = status;
    if (ticket_priority) updateData.ticket_priority = ticket_priority;
    
    // Only Admin can assign/reassign tickets
    if (emp_assigned) {
      if (user_type === 'ADMIN') {
        updateData.emp_assigned = emp_assigned;
      } else {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'Only administrators can assign tickets.' });
      }
    }

    await ticket.update(updateData);

    return res.json({
      success: true,
      message: 'Ticket updated successfully.',
      data: ticket
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/sessions/:sessionId/reply
 * Sends a WhatsApp message from the human agent to the customer,
 * and records it in the Messages table.
 */
exports.sendHandoverReply = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'message is required.' });
    }

    const session = await Session.findByPk(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, code: 'SESSION_NOT_FOUND', message: 'Session not found.' });
    }

    if (!session.is_handover) {
      return res.status(409).json({ success: false, code: 'NOT_IN_HANDOVER', message: 'Session is not in handover mode. Enable handover first.' });
    }

    const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioWhatsAppNumber = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';

    if (!twilioAccountSid || !twilioAuthToken || twilioAccountSid.startsWith('ACXXXX')) {
      return res.status(503).json({ success: false, code: 'TWILIO_NOT_CONFIGURED', message: 'Twilio credentials not configured.' });
    }

    const twilio = require('twilio');
    const client = twilio(twilioAccountSid, twilioAuthToken);

    const toWhatsApp = `whatsapp:${sessionId.startsWith('+') ? sessionId : '+' + sessionId}`;
    const msgResult = await client.messages.create({
      from: twilioWhatsAppNumber,
      to: toWhatsApp,
      body: message.trim()
    });

    // Record the agent reply in Messages table
    const crypto = require('node:crypto');
    const { Message } = require('../models');
    const timestampStr = new Date().toISOString();
    await Message.create({
      message_id: 'msg_' + crypto.randomUUID(),
      session_id: sessionId,
      content: message.trim(),
      from: 'SERVER',
      message_type: 'TEXT',
      status: 'SENT',
      created_at: timestampStr,
      updated_at: timestampStr
    });

    return res.json({
      success: true,
      message: 'Reply sent successfully via WhatsApp.',
      messageSid: msgResult.sid,
      to: toWhatsApp,
      body: message.trim()
    });
  } catch (err) {
    next(err);
  }
};

