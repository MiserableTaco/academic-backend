import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { EmailService } from '../services/email.service.js';
import { 
  RequestOTPSchema, 
  VerifyOTPSchema, 
  validateBody,
  RATE_LIMITS
} from '../lib/validation-schemas.js';
import crypto from 'crypto';

export async function authRoutes(fastify: FastifyInstance) {
  function hashOTP(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  function constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  // SECURITY FIX: Reduced from 50 to 5 requests per 15 minutes
  fastify.post('/request-otp', {
    config: {
      rateLimit: RATE_LIMITS.OTP_REQUEST
    }
  }, async (request, reply) => {
    try {
      // SECURITY FIX: Validate input with Zod
      const { email } = validateBody(RequestOTPSchema, request.body);

      const user = await prisma.user.findUnique({
        where: { email }
      });

      if (!user) {
        return { message: 'If the email exists, an OTP has been sent.' };
      }

      const code = crypto.randomInt(100000, 999999).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await prisma.oTPCode.deleteMany({
        where: { userId: user.id }
      });

      const hashedCode = hashOTP(code);

      await prisma.oTPCode.create({
        data: {
          userId: user.id,
          code: hashedCode,
          attempts: 0,
          maxAttempts: 5,
          expiresAt
        }
      });

      await EmailService.sendOTP(email, code);

      console.log(`📧 OTP sent to ${email}: ${code}`);

      return { message: 'If the email exists, an OTP has been sent.' };
    } catch (error: any) {
      fastify.log.error(error);
      
      if (error.name === 'ZodError') {
        return reply.code(400).send({ error: 'Invalid email format' });
      }
      
      return reply.code(500).send({ error: 'An error occurred. Please try again.' });
    }
  });

  fastify.post('/verify-otp', {
    config: {
      rateLimit: RATE_LIMITS.OTP_VERIFY
    }
  }, async (request, reply) => {
    try {
      const { email, code } = validateBody(VerifyOTPSchema, request.body);

      const user = await prisma.user.findUnique({
        where: { email },
        include: {
          otpCodes: {
            where: {
              expiresAt: { gte: new Date() }
            },
            orderBy: { createdAt: 'desc' },
            take: 1
          },
          institution: true
        }
      });

      if (!user || user.otpCodes.length === 0) {
        return reply.code(401).send({ error: 'Invalid or expired code' });
      }

      const otpCode = user.otpCodes[0];

      if (otpCode.attempts >= otpCode.maxAttempts) {
        await prisma.oTPCode.delete({ where: { id: otpCode.id } });
        
        await prisma.auditLog.create({
          data: {
            userId: user.id,
            action: 'login_failed',
            resource: 'Auth',
            details: { reason: 'Max OTP attempts exceeded', email },
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
            success: false
          }
        }).catch(() => {});

        return reply.code(401).send({ error: 'Too many attempts. Please request a new code.' });
      }

      const hashedCode = hashOTP(code);

      if (!constantTimeCompare(otpCode.code, hashedCode)) {
        await prisma.oTPCode.update({
          where: { id: otpCode.id },
          data: { attempts: { increment: 1 } }
        });

        await prisma.auditLog.create({
          data: {
            userId: user.id,
            action: 'login_failed',
            resource: 'Auth',
            details: { 
              reason: 'Invalid OTP code',
              attemptsRemaining: otpCode.maxAttempts - otpCode.attempts - 1,
              email
            },
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
            success: false
          }
        }).catch(() => {});

        const remaining = otpCode.maxAttempts - otpCode.attempts - 1;
        if (remaining <= 1) {
          return reply.code(401).send({ error: 'Invalid code. Last attempt remaining.' });
        }
        return reply.code(401).send({ error: `Invalid code. ${remaining} attempts remaining.` });
      }

      await prisma.oTPCode.delete({
        where: { id: otpCode.id }
      });

      const token = fastify.jwt.sign({
        userId: user.id,
        email: user.email,
        role: user.role,
        institutionId: user.institutionId
      });

      reply.setCookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60,
        path: '/
      });

      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'login_success',
          resource: 'Auth',
          details: { email: user.email },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          success: true
        }
      }).catch(() => {});

      console.log(`✅ User logged in: ${email}`);

      return {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          institutionId: user.institutionId,
          institution: user.institution
        }
      };
    } catch (error: any) {
      fastify.log.error(error);
      
      if (error.name === 'ZodError') {
        return reply.code(400).send({ error: 'Invalid code format' });
      }
      
      return reply.code(500).send({ error: 'An error occurred. Please try again.' });
    }
  });

  fastify.post('/logout', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user as any;
    
    await prisma.auditLog.create({
      data: {
        userId: user.userId,
        action: 'logout',
        resource: 'Auth',
        details: { email: user.email },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        success: true
      }
    }).catch(() => {});

    reply.clearCookie('token', { 
      path: '/',
      domain: undefined 
    });
    
    return { message: 'Logged out successfully' };
  });

  fastify.get('/verify', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const user = request.user as any;

    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      include: { institution: true }
    });

    if (!dbUser) {
      throw new Error('User not found');
    }

    return {
      user: {
        id: dbUser.id,
        email: dbUser.email,
        role: dbUser.role,
        institutionId: dbUser.institutionId,
        institution: dbUser.institution
      }
    };
  });
}
