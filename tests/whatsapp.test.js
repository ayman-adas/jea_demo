const request = require('supertest');
const app = require('../src/app');
const { User, Customer, Session, Ticket, Rating, sequelize } = require('../src/models');
const { initQaEngine } = require('../src/services/qaEngine');
const { sessionStates } = require('../src/controllers/whatsappController');

describe('WhatsApp Webhook Integration', () => {
  const testPhone = '+962777602924';
  const testWaFrom = 'whatsapp:+962777602924';

  beforeAll(async () => {
    // 1. Sync DB
    await sequelize.sync({ force: true });

    // 2. Initialize QA Engine
    await initQaEngine();

    // 3. Seed User and Customer
    await User.create({
      user_id: 'wa_test_user_id',
      name: 'أيمن عدس',
      user_type: 'CUSTOMER',
      status: 'ACTIVE'
    });

    await Customer.create({
      member_id: 'wa_test_user_id',
      phone: testPhone,
      gender: 'MALE',
      role: 'MEMBER'
    });
  });

  it('should answer high-confidence Q&A search query directly from guide', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .send({
        From: testWaFrom,
        Body: 'ما هي الوثائق المطلوبة لإصدار شهادة العضوية',
        ProfileName: 'أيمن عدس'
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('<Response>');
    expect(res.text).toContain('إصدار شهادة العضوية');
  });

  it('should immediately create a ticket on low-confidence query containing service/problem keywords', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .send({
        From: testWaFrom,
        Body: 'كيف أسجل في التقاعد المبكر',
        ProfileName: 'أيمن عدس'
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('تم تسجيل طلبك بنجاح وفتح تذكرة دعم');

    // Verify database has created the ticket
    const ticket = await Ticket.findOne({
      where: { user_id: 'wa_test_user_id' }
    });
    expect(ticket).toBeDefined();
    expect(ticket.status).toBe('OPEN');
  });

  it('should accept rating and transition state', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .send({
        From: testWaFrom,
        Body: '5',
        ProfileName: 'أيمن عدس'
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('كتابة أي ملاحظة أو تعليق إضافي');
    // Note: Rating record is created in the next comment submission step
  });

  it('should accept optional feedback and close the session', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .send({
        From: testWaFrom,
        Body: 'شكراً جزيلاً البوت رائع',
        ProfileName: 'أيمن عدس'
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('تم تسجيل طلبك وتقييمك بنجاح');

    // Verify rating has been recorded in database with the correct columns
    const rating = await Rating.findOne({
      where: { user_id: 'wa_test_user_id' }
    });
    expect(rating).toBeDefined();
    expect(rating.rate_value).toBe(5);
    expect(rating.comments).toBe('شكراً جزيلاً البوت رائع');

    // Verify session is closed
    const session = await Session.findOne({
      where: { session_id: testPhone },
      order: [['created_at', 'DESC']]
    });
    expect(session.status).toBe('CLOSED');
  });

  it('should accept Customer Satisfaction WhatsApp Flow submission and persist rating via API', async () => {
    // Clean previous ratings
    await Rating.destroy({ where: {} });

    const flowPayload = JSON.stringify({
      screen_id: 'rating_ar',
      data: {
        rating_ar: '5',
        question_1: '5',
        question_2: 'خدمة ممتازة وسريعة'
      }
    });

    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .send({
        From: testWaFrom,
        FlowData: flowPayload,
        ProfileName: 'أيمن عدس'
      });

    expect(res.text.includes('تم تسجيل تقييمك') || res.text.includes('recorded successfully')).toBe(true);

    // Verify rating recorded in database
    const rating = await Rating.findOne({
      where: { user_id: 'wa_test_user_id' }
    });
    expect(rating).toBeDefined();
    expect(rating.rate_value).toBe(5);
    expect(rating.comments).toBe('خدمة ممتازة وسريعة');
    expect(rating.status).toBe('ACTIVE');

    // Verify session is closed
    const session = await Session.findOne({
      where: { session_id: testPhone },
      order: [['created_at', 'DESC']]
    });
    expect(session.status).toBe('CLOSED');
  });

  it('should trigger support department menu when user requests support or complaints', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .send({
        From: testWaFrom,
        Body: 'شكاوي',
        ProfileName: 'أيمن عدس'
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('<Response');
  });

  it('should perform human handoff when user selects support department from list picker', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .send({
        From: testWaFrom,
        Body: 'handoff_health',
        ListId: 'handoff_health',
        ProfileName: 'أيمن عدس'
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('قسم التأمين الصحي');

    // Verify session handover state updated
    const session = await Session.findOne({
      where: { session_id: testPhone }
    });
    expect(session).toBeDefined();
    expect(session.is_handover).toBe(true);
  });

  it('should handle issue_certificate button reply and dispatch engineer member number text template', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .send({
        From: testWaFrom,
        Body: 'issue_certificate',
        ButtonPayload: 'issue_certificate',
        ProfileName: 'أيمن عدس'
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('<Response');
  });

  it('should reject invalid or non-6-digit member number and offer options 1 & 2', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .send({
        From: testWaFrom,
        Body: '123',
        ProfileName: 'أيمن عدس'
      });

    expect(res.status).toBe(200);
    expect(res.text.includes('Invalid membership number') || res.text.includes('غير صحيح')).toBe(true);
    expect(res.text.includes('1.') && res.text.includes('2.')).toBe(true);
  });

  it('should allow user to choose retry (1) and re-enter valid 6-digit member number (123456)', async () => {
    // Select option 1 to retry
    const retryRes = await request(app)
      .post('/api/whatsapp/webhook')
      .send({
        From: testWaFrom,
        Body: '1',
        ProfileName: 'أيمن عدس'
      });
    expect(retryRes.status).toBe(200);

    // Provide valid 6-digit registered member_id
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .send({
        From: testWaFrom,
        Body: '123456',
        ProfileName: 'أيمن عدس'
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('<Response');
  });

  it('should handle delivery_no button reply after member number and dispatch electronic copy payment prompt', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .send({
        From: testWaFrom,
        Body: 'delivery_no',
        ButtonPayload: 'delivery_no',
        ProfileName: 'أيمن عدس'
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('/payment?phone=');
    expect(res.text).toContain('amount=5.00');
  });

  it('should handle delivery_yes button reply after member number and dispatch receiver selection template', async () => {
    // Re-trigger issue certificate & member number for physical delivery branch
    await request(app).post('/api/whatsapp/webhook').send({ From: testWaFrom, Body: 'issue_certificate' });
    await request(app).post('/api/whatsapp/webhook').send({ From: testWaFrom, Body: '123456' });

    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .send({
        From: testWaFrom,
        Body: 'delivery_yes',
        ButtonPayload: 'delivery_yes',
        ProfileName: 'أيمن عدس'
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('<Response');
  });

  it('should handle receiver_self button reply and dispatch detailed address text template', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .send({
        From: testWaFrom,
        Body: 'receiver_self',
        ButtonPayload: 'receiver_self',
        ProfileName: 'أيمن عدس'
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('<Response');
  });

  it('should accept detailed delivery address and dispatch dynamic payment URL prompt', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .send({
        From: testWaFrom,
        Body: 'عمان، خلدا، شارع الملك عبدالله الثاني، بناية رقم 15',
        ProfileName: 'أيمن عدس'
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('/payment?phone=');
  });

  it('should accept payment submission via POST /api/whatsapp/payment/submit and return success', async () => {
    const res = await request(app)
      .post('/api/whatsapp/payment/submit')
      .send({
        cleanPhone: '0777602924',
        memberId: '123456',
        amount: '15.00',
        paymentMethod: 'Visa / MasterCard',
        transactionRef: 'TXN-981234',
        address: 'عمان، خلدا'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.transactionRef).toBe('TXN-981234');
  });

  it('should allow user to choose main menu (2) on invalid phone error choice', async () => {
    // Trigger issue certificate
    await request(app)
      .post('/api/whatsapp/webhook')
      .send({ From: testWaFrom, Body: 'issue_certificate', ButtonPayload: 'issue_certificate', ProfileName: 'أيمن عدس' });

    // Enter invalid phone to get choices
    await request(app)
      .post('/api/whatsapp/webhook')
      .send({ From: testWaFrom, Body: '999', ProfileName: 'أيمن عدس' });

    // Select option 2 to return to main menu
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .send({ From: testWaFrom, Body: '2', ProfileName: 'أيمن عدس' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('<Response');
  });




  it('should reply with I do not know on low-confidence general trivia questions and not open a ticket', async () => {
    // Clear previous sessions/tickets to isolate
    await Ticket.destroy({ where: {} });
    await Session.destroy({ where: {} });
    sessionStates.clear();

    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .send({
        From: testWaFrom,
        Body: 'ما هي عاصمة الأردن',
        ProfileName: 'أيمن عدس'
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('لم أتمكن من العثور على إجابة لاستفسارك');

    // Verify that NO ticket was created
    const ticketCount = await Ticket.count();
    expect(ticketCount).toBe(0);
  });
});



