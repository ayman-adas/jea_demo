const request = require('supertest');
const app = require('../src/app');
const { User, Customer, Session, Ticket, Rating, sequelize } = require('../src/models');
const { initQaEngine } = require('../src/services/qaEngine');

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

  it('should reply with I do not know on low-confidence general trivia questions and not open a ticket', async () => {
    // Clear previous sessions/tickets to isolate
    await Ticket.destroy({ where: {} });

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
