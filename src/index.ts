import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { authRoutes } from './routes/auth.js';
import { documentRoutes } from './routes/documents.js';
import { userRoutes } from './routes/users.js';
import { adminRoutes } from './routes/admin.js';
import { authenticate } from './middleware/auth.js';
import { requireAdmin, requireIssuerOrAdmin } from './middleware/roleCheck.js';
import { config } from './config.js';

const fastify = Fastify({ logger: true });

await fastify.register(cors, {
  origin: ['http://localhost:3001'],
  credentials: true
});

await fastify.register(jwt, { secret: config.jwtSecret });

await fastify.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1
  }
});

fastify.decorate('authenticate', authenticate);
fastify.decorate('requireAdmin', requireAdmin);
fastify.decorate('requireIssuerOrAdmin', requireIssuerOrAdmin);

fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

fastify.register(authRoutes, { prefix: '/api/auth' });
fastify.register(documentRoutes, { prefix: '/api/documents' });
fastify.register(userRoutes, { prefix: '/api/users' });
fastify.register(adminRoutes, { prefix: '/api/admin' });

const start = async () => {
  try {
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`🚀 Server running on http://localhost:${config.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
