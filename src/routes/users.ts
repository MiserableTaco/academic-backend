import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

export async function userRoutes(fastify: FastifyInstance) {
  fastify.get('/students', {
    onRequest: [fastify.authenticate, fastify.requireIssuerOrAdmin]
  }, async (request) => {
    const user = request.user as any;

    let students;

    if (user.role === 'ADMIN') {
      // ADMIN sees ALL students (no verified filter)
      students = await prisma.user.findMany({
        where: {
          role: 'STUDENT'
          // No verified filter for admin
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
