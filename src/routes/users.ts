import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

export async function userRoutes(fastify: FastifyInstance) {
  fastify.patch('/profile', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user as any;
    const { linkedinUrl } = request.body as any;

    if (linkedinUrl && !linkedinUrl.startsWith('https://linkedin.com/') && !linkedinUrl.startsWith('https://www.linkedin.com/')) {
      return reply.code(400).send({ error: 'Invalid LinkedIn URL' });
    }

    const updated = await prisma.user.update({
      where: { id: user.userId },
      data: { linkedinUrl }
    });

    return { linkedinUrl: updated.linkedinUrl };
  });
}
