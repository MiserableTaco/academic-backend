import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireAdmin } from '../middleware/roleCheck.js';

export async function adminRoutes(fastify: FastifyInstance) {
  fastify.get('/stats', {
    onRequest: [fastify.authenticate, requireAdmin]
  }, async (request, reply) => {
    try {
      const [totalUsers, totalDocuments, totalInstitutions] = await Promise.all([
        prisma.user.count(),
        prisma.document.count(),
        prisma.institution.count()
      ]);

      return {
        totalUsers,
        totalDocuments,
        totalInstitutions
      };
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Failed to fetch stats' });
    }
  });

  fastify.post('/whitelist', {
    onRequest: [fastify.authenticate, requireAdmin]
  }, async (request, reply) => {
    const { emails, institutionId } = request.body as any;
    
    if (!Array.isArray(emails) || emails.length === 0) {
      return reply.code(400).send({ error: 'Emails array required' });
    }

    const results = { added: 0, skipped: 0, errors: [] as string[] };

    for (const email of emails) {
      const trimmed = email.trim().toLowerCase();
      if (!trimmed || !trimmed.includes('@')) {
        results.errors.push(`Invalid: ${email}`);
        continue;
      }

      try {
        const exists = await prisma.user.findUnique({ where: { email: trimmed } });
        if (exists) {
          results.skipped++;
          continue;
        }

        await prisma.user.create({
          data: {
            email: trimmed,
            institutionId,
            role: 'STUDENT',
            verified: false
          }
        });
        results.added++;
      } catch (err) {
        results.errors.push(`Failed: ${email}`);
      }
    }

    return results;
  });

  fastify.delete('/whitelist', {
    onRequest: [fastify.authenticate, requireAdmin]
  }, async (request, reply) => {
    const { emails } = request.body as any;
    
    if (!Array.isArray(emails) || emails.length === 0) {
      return reply.code(400).send({ error: 'Emails array required' });
    }

    const deleted = await prisma.user.deleteMany({
      where: {
        email: { in: emails.map(e => e.trim().toLowerCase()) },
        documents: { none: {} }
      }
    });

    return { deleted: deleted.count };
  });
}
