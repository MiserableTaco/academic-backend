import { FastifyInstance } from 'fastify';
import { AuthService } from '../services/auth.service.js';

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/request-otp', async (req, reply) => {
    const { email } = req.body as any;
    if (!email) return reply.code(400).send({ error: 'Email required' });
    try {
      await AuthService.requestOTP(email, req.ip);
      return { message: 'OTP sent' };
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.post('/verify-otp', async (req, reply) => {
    const { email, code } = req.body as any;
    if (!email || !code) return reply.code(400).send({ error: 'Email and code required' });
    try {
      const result = await AuthService.verifyOTP(email, code, req.ip);
      const token = fastify.jwt.sign(AuthService.generateJWTPayload(result.user), { expiresIn: '24h' });
      return { user: result.user, token, requiresDeviceRegistration: result.requiresDeviceRegistration };
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });
}
