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

// DEPLOYMENT FIX: Dynamic CORS for dev and production
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  process.env.FRONTEND_URL, // Netlify URL
  process.env.VERICERT_URL   // VeriCert frontend URL
].filter(Boolean); // Remove undefined values

await fastify.register(cors, {
  origin: (origin, cb) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) {
      cb(null, true);
      return;
    }
    
    // Check if origin is allowed
    if (allowedOrigins.some(allowed => origin.startsWith(allowed))) {
      cb(null, true);
      return;
    }
    
    cb(new Error('Not allowed by CORS'), false);
  },
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
  return { status: 'ok', timestamp: new Date().toISOString() };
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
    const port = Number(process.env.PORT) || 3000;
    const host = process.env.HOST || '0.0.0.0';
    
    await fastify.listen({ port, host });
    
    console.log(`🚀 Server running on ${host}:${port}`);
    console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`✅ CORS enabled for: ${allowedOrigins.join(', ')}`);
    console.log(`🔒 Security: Rate limiting, CSRF, httpOnly cookies enabled`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
