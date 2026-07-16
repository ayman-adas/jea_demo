const request = require('supertest');
const app = require('../src/app');
const { User, sequelize } = require('../src/models');

describe('Authentication API', () => {
  let validRefreshToken = '';

  beforeAll(async () => {
    // Sync DB and seed an active admin user
    await sequelize.sync({ force: true });
    await User.create({
      user_id: 'admin',
      name: 'admin',
      user_type: 'ADMIN',
      status: 'ACTIVE'
    });
  });

  describe('POST /api/admin/auth/login', () => {
    it('should prompt for OTP if credentials are correct', async () => {
      const res = await request(app)
        .post('/api/admin/auth/login')
        .send({ username: 'admin', password: 'admin123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.requireOtp).toBe(true);
    });

    it('should fail if username or password is missing', async () => {
      const res = await request(app)
        .post('/api/admin/auth/login')
        .send({ username: 'admin' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should fail with incorrect credentials', async () => {
      const res = await request(app)
        .post('/api/admin/auth/login')
        .send({ username: 'admin', password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/admin/auth/verify-otp', () => {
    it('should verify OTP and return tokens on success', async () => {
      const res = await request(app)
        .post('/api/admin/auth/verify-otp')
        .send({ username: 'admin', otp: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('refreshToken');
      expect(res.body.data.user.name).toBe('admin');

      validRefreshToken = res.body.data.refreshToken;
    });

    it('should reject incorrect OTP', async () => {
      const res = await request(app)
        .post('/api/admin/auth/verify-otp')
        .send({ username: 'admin', otp: '000000' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/admin/auth/refresh-token', () => {
    it('should exchange refresh token for new access/refresh tokens', async () => {
      const res = await request(app)
        .post('/api/admin/auth/refresh-token')
        .send({ refreshToken: validRefreshToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('refreshToken');
    });

    it('should reject invalid or missing refresh token', async () => {
      const res = await request(app)
        .post('/api/admin/auth/refresh-token')
        .send({ refreshToken: 'invalid-token' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });
});
