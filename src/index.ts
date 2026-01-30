import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import csrf from '@fastify/csrf-protection';
import { prisma } from './lib/prisma.js';
import { authRoutes } from './routes/auth.js';
import { documentRoutes } from './routes/documents.js';
import { userRoutes } from './routes/users.js';
import { adminRoutes } from './routes/admin.js';

const fastify = Fastify({
  logger: true
});

// FIXED: Allow DELETE, PUT, PATCH methods
await fastify.register(cors, {
  origin: ['http://localhost:3001', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token']
});

await fastify.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

await fastify.register(cookie, {
  secret: process.env.COOKIE_SECRET || 'your-cookie-secret-min-32-chars-long-change-in-production',
  hook: 'onRequest'
});

await fastify.register(csrf, {
  cookieOpts: { signed: true }
});

await fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'your-secret-key-change-this-in-production'
});

await fastify.register(rateLimit, {
  global: true,
  max: 100,
  timeWindow: '15 minutes'
});

fastify.decorate('authenticate', async function(request: any, reply: any) {
  try {
    const token = request.cookies.token || request.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const decoded = fastify.jwt.verify(token);
    request.user = decoded;
  } catch (err) {
    return reply.code(401).send({ error: 'Invalid token' });
  }
});

fastify.decorate('requireAdmin', async function(request: any, reply: any) {
  if (request.user.role !== 'ADMIN') {
    return reply.code(403).send({ error: 'Admin access required' });
  }
});

fastify.decorate('requireIssuerOrAdmin', async function(request: any, reply: any) {
  if (request.user.role !== 'ADMIN' && request.user.role !== 'ISSUER') {
    return reply.code(403).send({ error: 'Issuer or Admin access required' });
  }
});

fastify.get('/health', async () => {
  return { status: 'ok' };
});

fastify.get('/api/csrf-token', async (request, reply) => {
  const token = await reply.generateCsrf();
  return { csrfToken: token };
});

await fastify.register(authRoutes, { prefix: '/api/auth' });
await fastify.register(documentRoutes, { prefix: '/api/documents' });
await fastify.register(userRoutes, { prefix: '/api/users' });
await fastify.register(adminRoutes, { prefix: '/api/admin' });

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('🚀 Server running on http://localhost:3000');
    console.log('✅ CORS enabled for http://localhost:3001');
    console.log('🔒 Security: Rate limiting, CSRF, httpOnly cookies enabled');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
