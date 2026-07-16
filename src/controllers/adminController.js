const { User, Session, Message, Ticket, Customer } = require('../models');
const { generateToken } = require('../middleware/authMiddleware');
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

    // Issue JWT token on successful verification
    const token = generateToken(targetUser);
    return res.json({
      success: true,
      data: {
        token,
        user: targetUser
      }
    });
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
