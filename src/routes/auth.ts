import { FastifyInstance } from 'fastify';
import { AuthService } from '../services/auth.service.js';
import { prisma } from '../lib/prisma.js';

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/request-otp', async (request, reply) => {
    const { email } = request.body as { email: string };

    if (!email || !email.includes('@')) {
      return reply.code(400).send({ error: 'Valid email required' });
    }

    try {
      await AuthService.requestOTP(email);
      return { message: 'Verification code sent' };
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.post('/verify-otp', async (request, reply) => {
    const { email, code } = request.body as { email: string; code: string };

    if (!email || !code) {
      return reply.code(400).send({ error: 'Email and code required' });
    }

    try {
      const payload = await AuthService.verifyOTP(email, code);
      
      const token = fastify.jwt.sign(payload);

      return {
        token,
        user: {
          email: payload.email,
          role: payload.role,
          institutionId: payload.institutionId
        }
      };
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(401).send({ error: error.message });
    }
  });

  fastify.get('/me', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const user = request.user as any;
    
    const fullUser = await prisma.user.findUnique({
      where: { id: user.userId },
      include: { institution: true }
    });

    return {
      user: {
        id: fullUser?.id,
        email: fullUser?.email,
        role: fullUser?.role,
        institutionId: fullUser?.institutionId,
        institution: fullUser?.institution.name
      }
    };
  });
}
