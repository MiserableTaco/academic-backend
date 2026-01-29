import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { config } from './config/index.js';
import { authRoutes } from './routes/auth.js';
import { documentRoutes } from './routes/documents.js';
import { adminRoutes } from './routes/admin.js';
import { userRoutes } from './routes/users.js';
import { authenticate } from './middleware/auth.js';
import { requireAdmin, requireIssuerOrAdmin } from './middleware/roleCheck.js';

const fastify = Fastify({
  logger: true,
  bodyLimit: 52428800 // 50MB
});

// Decorators
fastify.decorate('authenticate', authenticate);
fastify.decorate('requireAdmin', requireAdmin);
fastify.decorate('requireIssuerOrAdmin', requireIssuerOrAdmin);

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: typeof authenticate;
    requireAdmin: typeof requireAdmin;
    requireIssuerOrAdmin: typeof requireIssuerOrAdmin;
  }
}

async function start() {
  try {
    // CORS
    await fastify.register(cors, {
      origin: ['http://localhost:3001'],
      credentials: true,
      exposedHeaders: ['Content-Disposition'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
    });

    // JWT
    await fastify.register(jwt, {
      secret: config.jwtSecret
    });

    // Multipart (file uploads)
    await fastify.register(multipart, {
      limits: {
        fileSize: 52428800 // 50MB
      }
    });

    // Routes
    await fastify.register(authRoutes, { prefix: '/api/auth' });
    await fastify.register(documentRoutes, { prefix: '/api/documents' });
    await fastify.register(adminRoutes, { prefix: '/api/admin' });
    await fastify.register(userRoutes, { prefix: '/api/users' });

    // Health check
    fastify.get('/health', async () => {
      return { status: 'ok' };
    });

    // Start server
    await fastify.listen({
      port: config.port,
      host: '0.0.0.0'
    });

    console.log(`\n🚀 Server running on http://localhost:${config.port}\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
