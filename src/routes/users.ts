import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireIssuerOrAdmin } from '../middleware/roleCheck.js';

export async function userRoutes(fastify: FastifyInstance) {
  // Get students from same institution
  fastify.get('/students', {
    onRequest: [fastify.authenticate, requireIssuerOrAdmin]
  }, async (request) => {
    const user = request.user as any;
    
    const students = await prisma.user.findMany({
      where: {
        institutionId: user.institutionId,
        role: 'STUDENT',
        revokedAt: null
      },
      select: {
        id: true,
        email: true
      },
      orderBy: {
        email: 'asc'
      }
    });

    return { students };
  });
}
