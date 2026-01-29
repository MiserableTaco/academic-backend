#!/bin/bash

# COMPLETE BACKEND SETUP SCRIPT
# This creates EVERY file needed for a working backend
# Run from: ~/Desktop/academic/backend

set -e  # Exit on any error

echo "=========================================="
echo "Creating COMPLETE Backend Files"
echo "=========================================="

# Create all directories
echo "Creating directories..."
mkdir -p src/config
mkdir -p src/lib
mkdir -p src/routes
mkdir -p src/services
mkdir -p src/middleware
mkdir -p src/types
mkdir -p prisma

# ====================
# 1. CONFIGURATION
# ====================
echo "Creating config..."
cat > src/config/index.ts << 'EOF'
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL!,
  jwtSecret: process.env.JWT_SECRET!,
  jwtExpiresIn: '24h',
  otpExpiryMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10),
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
  },
  fromEmail: process.env.FROM_EMAIL || 'noreply@example.com',
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3001',
};
EOF

# ====================
# 2. PRISMA CLIENT
# ====================
echo "Creating Prisma client..."
cat > src/lib/prisma.ts << 'EOF'
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
EOF

# ====================
# 3. SERVICES
# ====================
echo "Creating auth service..."
cat > src/services/auth.service.ts << 'EOF'
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { AccessAction } from '@prisma/client';

export class AuthService {
  static async requestOTP(email: string, ipAddress: string = '0.0.0.0'): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { institution: true },
    });

    if (!user) {
      throw new Error('Email not registered. Please contact your institution administrator.');
    }

    if (user.institution.status !== 'ACTIVE') {
      throw new Error('Your institution is currently suspended.');
    }

    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.oTPVerification.updateMany({
      where: { userId: user.id, verified: false },
      data: { expiresAt: new Date(0) },
    });

    await prisma.oTPVerification.create({
      data: {
        userId: user.id,
        email: email.toLowerCase(),
        code,
        expiresAt,
      },
    });

    await prisma.accessLog.create({
      data: {
        actorId: user.id,
        action: AccessAction.OTP_REQUEST,
        ipAddress,
        metadata: { email },
      },
    });

    console.log(`📧 OTP for ${email}: ${code} (expires in 10 minutes)`);
  }

  static async verifyOTP(
    email: string,
    code: string,
    ipAddress: string = '0.0.0.0'
  ): Promise<{ user: any; requiresDeviceRegistration: boolean }> {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        institution: true,
        devices: { where: { revoked: false } },
      },
    });

    if (!user) {
      throw new Error('Invalid email or verification code.');
    }

    const otp = await prisma.oTPVerification.findFirst({
      where: { userId: user.id, code, verified: false },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      await prisma.accessLog.create({
        data: {
          actorId: user.id,
          action: AccessAction.OTP_VERIFY,
          ipAddress,
          metadata: { success: false, reason: 'invalid_code' },
        },
      });
      throw new Error('Invalid verification code.');
    }

    if (otp.expiresAt < new Date()) {
      throw new Error('Verification code has expired. Please request a new one.');
    }

    if (otp.attempts >= 5) {
      throw new Error('Too many attempts. Please request a new verification code.');
    }

    await prisma.oTPVerification.update({
      where: { id: otp.id },
      data: { attempts: otp.attempts + 1 },
    });

    await prisma.oTPVerification.update({
      where: { id: otp.id },
      data: { verified: true },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        verified: true,
        lastLoginAt: new Date(),
      },
    });

    await prisma.accessLog.create({
      data: {
        actorId: user.id,
        action: AccessAction.OTP_VERIFY,
        ipAddress,
        metadata: { success: true },
      },
    });

    const requiresDeviceRegistration = user.devices.length === 0;

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        institutionId: user.institutionId,
        institutionName: user.institution.name,
      },
      requiresDeviceRegistration,
    };
  }

  static generateJWTPayload(user: any): any {
    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      institutionId: user.institutionId,
    };
  }
}
EOF

# ====================
# 4. ROUTES
# ====================
echo "Creating auth routes..."
cat > src/routes/auth.ts << 'EOF'
import { FastifyInstance } from 'fastify';
import { AuthService } from '../services/auth.service.js';

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/request-otp', async (request, reply) => {
    const { email } = request.body as { email: string };
    
    if (!email) {
      return reply.code(400).send({ error: 'Email is required' });
    }

    try {
      const ipAddress = request.ip;
      await AuthService.requestOTP(email, ipAddress);
      return { message: 'OTP sent to your email' };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  fastify.post('/verify-otp', async (request, reply) => {
    const { email, code } = request.body as { email: string; code: string };
    
    if (!email || !code) {
      return reply.code(400).send({ error: 'Email and code are required' });
    }

    try {
      const ipAddress = request.ip;
      const result = await AuthService.verifyOTP(email, code, ipAddress);
      
      const token = fastify.jwt.sign(
        AuthService.generateJWTPayload(result.user),
        { expiresIn: '24h' }
      );
      
      return {
        user: result.user,
        token,
        requiresDeviceRegistration: result.requiresDeviceRegistration,
      };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  fastify.get('/me', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    return { user: request.user };
  });

  fastify.post('/logout', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    return { message: 'Logged out successfully' };
  });
}
EOF

echo "Creating documents routes..."
cat > src/routes/documents.ts << 'EOF'
import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

export async function documentRoutes(fastify: FastifyInstance) {
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const user = request.user as any;
    
    const documents = await prisma.document.findMany({
      where: { userId: user.userId },
      include: {
        institution: {
          select: { name: true }
        }
      },
      orderBy: { issuedAt: 'desc' }
    });

    return { documents };
  });

  fastify.get('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user as any;
    const { id } = request.params as { id: string };

    const document = await prisma.document.findFirst({
      where: {
        id,
        userId: user.userId
      },
      include: {
        institution: {
          select: { name: true, publicKey: true }
        }
      }
    });

    if (!document) {
      return reply.code(404).send({ error: 'Document not found' });
    }

    return { document };
  });
}
EOF

# ====================
# 5. MIDDLEWARE
# ====================
echo "Creating middleware..."
cat > src/middleware/auth.ts << 'EOF'
import { FastifyRequest, FastifyReply } from 'fastify';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}
EOF

# ====================
# 6. MAIN SERVER
# ====================
echo "Creating main server..."
cat > src/index.ts << 'EOF'
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import { config } from './config/index.js';
import { authRoutes } from './routes/auth.js';
import { documentRoutes } from './routes/documents.js';
import { authenticate } from './middleware/auth.js';

const fastify = Fastify({
  logger: {
    level: config.nodeEnv === 'production' ? 'info' : 'debug',
  },
});

async function start() {
  try {
    await fastify.register(cors, {
      origin: config.corsOrigin,
      credentials: true,
    });

    await fastify.register(rateLimit, {
      max: config.rateLimitMax,
      timeWindow: config.rateLimitWindow,
    });

    await fastify.register(jwt, {
      secret: config.jwtSecret,
    });

    fastify.decorate('authenticate', authenticate);

    await fastify.register(authRoutes, { prefix: '/api/auth' });
    await fastify.register(documentRoutes, { prefix: '/api/documents' });

    fastify.get('/health', async () => {
      return { 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      };
    });

    fastify.setErrorHandler((error, request, reply) => {
      fastify.log.error(error);
      
      if (config.nodeEnv === 'production') {
        reply.code(error.statusCode || 500).send({
          error: 'Internal Server Error',
          statusCode: error.statusCode || 500
        });
      } else {
        reply.code(error.statusCode || 500).send({
          error: error.message,
          statusCode: error.statusCode || 500,
          stack: error.stack
        });
      }
    });

    await fastify.listen({
      port: config.port,
      host: config.host,
    });

    console.log('');
    console.log('========================================');
    console.log('🚀 Server running successfully!');
    console.log('========================================');
    console.log(`📍 URL: http://${config.host}:${config.port}`);
    console.log(`🏥 Health: http://${config.host}:${config.port}/health`);
    console.log(`🔐 Auth: http://${config.host}:${config.port}/api/auth`);
    console.log(`📄 Docs: http://${config.host}:${config.port}/api/documents`);
    console.log('========================================');
    console.log('');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
EOF

# ====================
# 7. TYPESCRIPT CONFIG
# ====================
echo "Creating TypeScript config..."
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "moduleResolution": "node",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
EOF

# ====================
# 8. SEED FILE
# ====================
echo "Creating seed file..."
cat > prisma/seed.ts << 'EOF'
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

function generateKeyPair() {
  return {
    publicKey: crypto.randomBytes(32).toString('base64'),
    privateKey: crypto.randomBytes(32).toString('base64'),
  };
}

async function main() {
  console.log('');
  console.log('========================================');
  console.log('🌱 Seeding database...');
  console.log('========================================');
  console.log('');

  const { publicKey, privateKey } = generateKeyPair();

  const institution = await prisma.institution.upsert({
    where: { emailDomain: 'nus.edu.sg' },
    update: {},
    create: {
      name: 'National University of Singapore',
      emailDomain: 'nus.edu.sg',
      publicKey,
      privateKey,
      status: 'ACTIVE',
    },
  });

  console.log('✅ Institution:', institution.name);
  console.log('📧 Email Domain:', institution.emailDomain);
  console.log('');
  console.log('🔐 SAVE THIS PRIVATE KEY:');
  console.log('─────────────────────────────────────');
  console.log(privateKey);
  console.log('─────────────────────────────────────');
  console.log('⚠️  You need this to sign documents!');
  console.log('');

  const admin = await prisma.user.upsert({
    where: { email: 'admin@nus.edu.sg' },
    update: {},
    create: {
      email: 'admin@nus.edu.sg',
      institutionId: institution.id,
      role: 'ADMIN',
      verified: true,
    },
  });

  console.log('✅ Created user:', admin.email, '(ADMIN)');

  const issuer = await prisma.user.upsert({
    where: { email: 'registrar@nus.edu.sg' },
    update: {},
    create: {
      email: 'registrar@nus.edu.sg',
      institutionId: institution.id,
      role: 'ISSUER',
      verified: true,
    },
  });

  console.log('✅ Created user:', issuer.email, '(ISSUER)');

  const student = await prisma.user.upsert({
    where: { email: 'student@nus.edu.sg' },
    update: {},
    create: {
      email: 'student@nus.edu.sg',
      institutionId: institution.id,
      role: 'STUDENT',
      verified: true,
    },
  });

  console.log('✅ Created user:', student.email, '(STUDENT)');
  console.log('');
  console.log('========================================');
  console.log('🎉 Seeding completed successfully!');
  console.log('========================================');
  console.log('');
}

main()
  .catch((e) => {
    console.error('');
    console.error('========================================');
    console.error('❌ Error seeding database:');
    console.error('========================================');
    console.error(e);
    console.error('');
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
EOF

# ====================
# 9. ENVIRONMENT FILE
# ====================
echo "Creating .env.example..."
cat > .env.example << 'EOF'
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/academic_verification?schema=public"

# Server
NODE_ENV="development"
PORT=3000
HOST="0.0.0.0"

# JWT
JWT_SECRET="your-super-secret-jwt-key-change-this-in-production"

# OTP
OTP_EXPIRY_MINUTES=10

# Email (for OTP codes)
SMTP_HOST="smtp.sendgrid.net"
SMTP_PORT=587
SMTP_USER="apikey"
SMTP_PASSWORD="your-sendgrid-api-key"
FROM_EMAIL="noreply@yourdomain.com"

# S3 Storage (optional for now)
S3_BUCKET="academic-documents"
S3_REGION="ap-southeast-1"
AWS_ACCESS_KEY_ID="your-access-key"
AWS_SECRET_ACCESS_KEY="your-secret-key"

# KMS (optional for now)
KMS_KEY_ID="your-kms-key-id"

# Security
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=900000

# CORS
CORS_ORIGIN="http://localhost:3001"
EOF

# ====================
# VERIFICATION
# ====================
echo ""
echo "=========================================="
echo "Verifying all files created..."
echo "=========================================="

files_to_check=(
  "src/config/index.ts"
  "src/lib/prisma.ts"
  "src/services/auth.service.ts"
  "src/routes/auth.ts"
  "src/routes/documents.ts"
  "src/middleware/auth.ts"
  "src/index.ts"
  "tsconfig.json"
  "prisma/seed.ts"
  ".env.example"
)

all_exist=true
for file in "${files_to_check[@]}"; do
  if [ -f "$file" ]; then
    echo "✅ $file"
  else
    echo "❌ MISSING: $file"
    all_exist=false
  fi
done

echo ""
if [ "$all_exist" = true ]; then
  echo "=========================================="
  echo "✅ All files created successfully!"
  echo "=========================================="
  echo ""
  echo "Next steps:"
  echo "1. Copy .env.example to .env and configure it"
  echo "2. Run: npm run db:generate"
  echo "3. Run: npm run db:seed"
  echo "4. Run: npm run dev"
  echo ""
else
  echo "=========================================="
  echo "❌ Some files are missing!"
  echo "=========================================="
  exit 1
fi
EOF

chmod +x /mnt/user-data/outputs/create-complete-backend.sh
cat /mnt/user-data/outputs/create-complete-backend.sh
