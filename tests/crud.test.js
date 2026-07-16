const request = require('supertest');
const app = require('../src/app');
const { User, Customer, Session, Message, Ticket, AuditLog, sequelize } = require('../src/models');

describe('CRUD API Routes (/api/v1)', () => {
  beforeAll(async () => {
    // Synchronize DB
    await sequelize.sync({ force: true });
  });

  describe('Users CRUD', () => {
    const testUser = {
      user_id: 'user_crud_test',
      name: 'CRUD User',
      user_type: 'CUSTOMER',
      status: 'ACTIVE'
    };

    it('should create a User', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .send(testUser);

      expect(res.status).toBe(201 || 200);
      expect(res.body.data.user_id).toBe(testUser.user_id);
    });

    it('should find all Users', async () => {
      const res = await request(app).get('/api/v1/users');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('should find User by ID', async () => {
      const res = await request(app).get(`/api/v1/users/${testUser.user_id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe(testUser.name);
    });

    it('should update User details', async () => {
      const res = await request(app)
        .put(`/api/v1/users/${testUser.user_id}`)
        .send({ name: 'Updated CRUD Name' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated CRUD Name');
    });

    it('should delete User', async () => {
      const res = await request(app).delete(`/api/v1/users/${testUser.user_id}`);
      expect(res.status).toBe(200 || 204);
    });
  });

  describe('Customers CRUD', () => {
    const testUserId = 'user_customer_test';
    const testCustomer = {
      member_id: testUserId,
      phone: '+962777602924',
      gender: 'MALE',
      role: 'MEMBER'
    };

    beforeAll(async () => {
      // Must seed a user for the customer foreign key
      await User.create({
        user_id: testUserId,
        name: 'Customer Associated User',
        user_type: 'CUSTOMER',
        status: 'ACTIVE'
      });
    });

    it('should create a Customer', async () => {
      const res = await request(app)
        .post('/api/v1/customers')
        .send(testCustomer);

      expect(res.status).toBe(201 || 200);
      expect(res.body.data.member_id).toBe(testCustomer.member_id);
    });

    it('should find all Customers', async () => {
      const res = await request(app).get('/api/v1/customers');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should find Customer by ID', async () => {
      const res = await request(app).get(`/api/v1/customers/${testCustomer.member_id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.phone).toBe(testCustomer.phone);
    });

    it('should update Customer role', async () => {
      const res = await request(app)
        .put(`/api/v1/customers/${testCustomer.member_id}`)
        .send({ role: 'VIP' });

      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('VIP');
    });

    it('should delete Customer', async () => {
      const res = await request(app).delete(`/api/v1/customers/${testCustomer.member_id}`);
      expect(res.status).toBe(200 || 204);
    });
  });

  describe('Sessions CRUD', () => {
    const testSession = {
      session_id: 'session_crud_test',
      status: 'OPEN',
      is_handover: false
    };

    it('should create a Session', async () => {
      const res = await request(app)
        .post('/api/v1/sessions')
        .send(testSession);

      expect(res.status).toBe(201);
      expect(res.body.data.session_id).toBe(testSession.session_id);
    });

    it('should find all Sessions', async () => {
      const res = await request(app).get('/api/v1/sessions');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should find Session by ID', async () => {
      const res = await request(app).get(`/api/v1/sessions/${testSession.session_id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(testSession.status);
    });

    it('should update Session handover state', async () => {
      const res = await request(app)
        .put(`/api/v1/sessions/${testSession.session_id}`)
        .send({ is_handover: true });

      expect(res.status).toBe(200);
      expect(res.body.data.is_handover).toBe(true);
    });

    it('should delete Session', async () => {
      const res = await request(app).delete(`/api/v1/sessions/${testSession.session_id}`);
      expect(res.status).toBe(200 || 204);
    });
  });

  describe('Tickets CRUD', () => {
    const testCustId = 'cust_ticket_user';
    const testTicket = {
      ticket_id: 'ticket_crud_test',
      title: 'CRUD Ticket Test',
      content: 'Ticket body test',
      status: 'OPEN',
      ticket_priority: 'MEDIUM',
      user_id: testCustId
    };

    beforeAll(async () => {
      await User.create({
        user_id: testCustId,
        name: 'Ticket User',
        user_type: 'CUSTOMER',
        status: 'ACTIVE'
      });
      await Customer.create({
        member_id: testCustId,
        phone: '+962777333444',
        gender: 'MALE',
        role: 'MEMBER'
      });
    });

    it('should create a Ticket', async () => {
      const res = await request(app)
        .post('/api/v1/tickets')
        .send(testTicket);

      expect(res.status).toBe(201 || 200);
      expect(res.body.data.ticket_id).toBe(testTicket.ticket_id);
    });

    it('should find all Tickets', async () => {
      const res = await request(app).get('/api/v1/tickets');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should find Ticket by ID', async () => {
      const res = await request(app).get(`/api/v1/tickets/${testTicket.ticket_id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe(testTicket.title);
    });

    it('should update Ticket priority', async () => {
      const res = await request(app)
        .put(`/api/v1/tickets/${testTicket.ticket_id}`)
        .send({ ticket_priority: 'HIGH' });

      expect(res.status).toBe(200);
      expect(res.body.data.ticket_priority).toBe('HIGH');
    });

    it('should delete Ticket', async () => {
      const res = await request(app).delete(`/api/v1/tickets/${testTicket.ticket_id}`);
      expect(res.status).toBe(200 || 204);
    });
  });
});
