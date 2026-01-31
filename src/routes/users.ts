import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { RATE_LIMITS } from '../lib/validation-schemas.js';

export async function userRoutes(fastify: FastifyInstance) {
  // SECURITY FIX: Add rate limiting
  fastify.get('/students', {
    onRequest: [fastify.authenticate, fastify.requireIssuerOrAdmin],
    config: { rateLimit: RATE_LIMITS.USER_LIST }
  }, async (request) => {
    const user = request.user as any;

    let students;

    if (user.role === 'ADMIN') {
      // ADMIN sees ALL students (no verified filter)
      students = await prisma.user.findMany({
        where: {
          role: 'STUDENT'
        },
        select: {
          id: true,
          email: true,
          verified: true,
          institutionId: true,
          institution: {
            select: {
              name: true
            }
          }
        },
        orderBy: { email: 'asc' }
      });
    } else {
      // ISSUER sees only verified students in their institution
      students = await prisma.user.findMany({
        where: {
          role: 'STUDENT',
          verified: true,
          institutionId: user.institutionId
        },
        select: {
          id: true,
          email: true,
          verified: true,
          institutionId: true,
          institution: {
            select: {
              name: true
            }
          }
        },
        orderBy: { email: 'asc' }
      });
    }

    return { students };
  });
}
