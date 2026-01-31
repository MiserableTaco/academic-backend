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

// DEPLOYMENT: Dynamic CORS for dev and production
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002', // VeriCert local
  process.env.FRONTEND_URL, // Netlify AcadCert URL
  process.env.VERICERT_URL   // Netlify VeriCert URL
].filter(Boolean);

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

// FIX: Cookie configuration for cross-origin (Netlify → Railway)
await fastify.register(cookie, {
  secret: process.env.COOKIE_SECRET || '0c+d1OYo9NSEISl8PMDhIT9RLMJ850Fr6RlEQ/TFo3EwlHXMr8rNyPTTrXgaH2Kd/hYR2R7tenNrEyQyAKG9Gg==', // ← REPLACE WITH CRYPTO SECRET IN RAILWAY
  hook: 'onRequest',
  parseOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // Only HTTPS in production
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // CRITICAL: Allow cross-origin in production
    path: '/'
  }
});

// CSRF protection (uses signed cookies)
await fastify.register(csrf, {
  cookieOpts: { 
    signed: true,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  }
});

await fastify.register(jwt, {
  secret: process.env.JWT_SECRET || '2pvM0+Gg5yeR2NwQHLnXEAA+SZ8qqTdwJBKbetTjaKrkGaPVRh8WCOu5fZesXlbKOUrNhQ4+MF8xOCEeq4wocg==' // ← REPLACE WITH CRYPTO SECRET IN RAILWAY
});

await fastify.register(rateLimit, {
  global: true,
  max: 100,
  timeWindow: '15 minutes'
});

// Authentication decorator
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

// Role-based authorization decorators
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

// Health check endpoint
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// CSRF token endpoint
fastify.get('/api/csrf-token', async (request, reply) => {
  const token = await reply.generateCsrf();
  return { csrfToken: token };
});

// Register routes
await fastify.register(authRoutes, { prefix: '/api/auth' });
await fastify.register(documentRoutes, { prefix: '/api/documents' });
await fastify.register(userRoutes, { prefix: '/api/users' });
await fastify.register(adminRoutes, { prefix: '/api/admin' });

// Start server
const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000;
    const host = process.env.HOST || '0.0.0.0';
    
    await fastify.listen({ port, host });
    
    console.log(`🚀 Server running on ${host}:${port}`);
    console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`✅ CORS enabled for: ${allowedOrigins.join(', ')}`);
    console.log(`🔒 Security: Rate limiting, CSRF, httpOnly cookies enabled`);
    console.log(`🍪 Cookie SameSite: ${process.env.NODE_ENV === 'production' ? 'none (cross-origin)' : 'lax (local)'}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
