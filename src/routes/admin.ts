import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { BulkUploadSchema, validateBody, safeValidate, MAX_CSV_SIZE, RATE_LIMITS } from '../lib/validation-schemas.js';
import fs from 'fs/promises';
import path from 'path';
import { parse } from 'csv-parse/sync';

export async function adminRoutes(fastify: FastifyInstance) {

  fastify.get('/stats', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    config: { rateLimit: RATE_LIMITS.ADMIN_READ }
  }, async () => {
    const [users, documents, institutions, recentAudits] = await Promise.all([
      prisma.user.count(),
      prisma.document.count(),
      prisma.institution.count(),
      prisma.auditLog.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          }
        }
      })
    ]);

    return { 
      totalUsers: users, 
      totalDocuments: documents, 
      totalInstitutions: institutions, 
      recentAudits 
    };
 });

  fastify.get('/users', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    config: { rateLimit: RATE_LIMITS.ADMIN_READ }
  }, async () => {
    const users = await prisma.user.findMany({
      include: {
        institution: true
      },
      orderBy: { createdAt: 'desc' }
    });

    return { users };
  });

  fastify.get('/documents', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    config: { rateLimit: RATE_LIMITS.ADMIN_READ }
  }, async () => {
    const documents = await prisma.document.findMany({
      include: {
        user: true,
        institution: true
      },
      orderBy: { createdAt: 'desc' }
    });

    return { documents };
  });

  fastify.get('/institutions', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    config: { rateLimit: RATE_LIMITS.ADMIN_READ }
  }, async () => {
    const institutions = await prisma.institution.findMany({
      orderBy: { createdAt: 'desc' }
    });

    return { institutions };
  });

  fastify.get('/audit-logs', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    config: { rateLimit: RATE_LIMITS.ADMIN_READ }
  }, async () => {
    const logs = await prisma.auditLog.findMany({
      include: {
        user: true
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    return { logs };
  });

  fastify.get('/security-events', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    config: { rateLimit: RATE_LIMITS.ADMIN_READ }
  }, async () => {
    const events = await prisma.auditLog.findMany({
      where: {
        success: false,
        action: {
          in: ['login_failed', 'unauthorized_access']
        }
      },
      include: {
        user: true
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    return { events };
  });

  fastify.get('/health', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    config: { rateLimit: RATE_LIMITS.ADMIN_READ }
  }, async () => {
    const uploadsDir = path.join(process.cwd(), 'uploads');
    
    let fileCount = 0;
    let totalSize = 0;

    try {
      await fs.access(uploadsDir);
      const files = await fs.readdir(uploadsDir);
      
      for (const file of files) {
        try {
          const filePath = path.join(uploadsDir, file);
          const stats = await fs.stat(filePath);
          
          if (stats.isFile()) {
            fileCount++;
            totalSize += stats.size;
          }
        } catch (err) {
          continue;
        }
      }
    } catch (err) {
      console.warn('Uploads directory not accessible:', err);
    }

    let databaseStatus = 'healthy';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      databaseStatus = 'unhealthy';
    }

    const documentsInDB = await prisma.document.count();
    const activeDocuments = await prisma.document.count({
      where: { status: 'ACTIVE' }
    });

    const recentErrors = await prisma.auditLog.findMany({
      where: {
        success: false,
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
        }
      },
      take: 5,
      orderBy: { createdAt: 'desc' }
    });

    const errors = recentErrors.map(log => ({
      time: log.createdAt,
      action: log.action,
      details: log.details
    }));

    const uptimeSeconds = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    const formattedUptime = `${hours}h ${minutes}m ${seconds}s`;

    return {
      database: databaseStatus,
      storage: {
        filesOnDisk: fileCount,
        totalSize: `${(totalSize / 1024 / 1024).toFixed(2)} MB`,
        documentsInDB,
        activeDocuments
      },
      uptime: formattedUptime,
      errors
    };
  });

  // SECURITY FIX: Stricter rate limit + file size check
  fastify.post('/bulk-upload', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    config: { rateLimit: RATE_LIMITS.ADMIN_WRITE }
  }, async (request, reply) => {
    const data = await request.file();
    
    if (!data) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }

    try {
      const buffer = await data.toBuffer();
      
      // SECURITY FIX: Check CSV size
      if (buffer.length > MAX_CSV_SIZE) {
        return reply.code(400).send({ error: 'CSV file too large. Maximum 5MB allowed.' });
      }
      
      const csvContent = buffer.toString('utf-8');
      
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true
      });

      // SECURITY FIX: Limit number of records
      if (records.length > 1000) {
        return reply.code(400).send({ error: 'Too many records. Maximum 1000 users per upload.' });
      }

      let successful = 0;
      let failed = 0;
      const errors: any[] = [];

      for (const record of records) {
        try {
          // SECURITY FIX: Validate with Zod
          const result = safeValidate(BulkUploadSchema, record);
          
          if (!result.success) {
            throw new Error('Invalid data format');
          }

          const { email, role, institutionId } = result.data;

          const existing = await prisma.user.findUnique({
            where: { email }
          });

          if (existing) {
            throw new Error('User already exists');
          }

          await prisma.user.create({
            data: {
              id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              email,
              role,
              institutionId,
              verified: true,
              whitelistedAt: new Date()
            }
          });

          successful++;
        } catch (err: any) {
          failed++;
          errors.push({
            email: record.email,
            error: err.message
          });
        }
      }

      return {
        total: records.length,
        successful,
        failed,
        errors: errors.slice(0, 10)
      };
    } catch (err: any) {
      return reply.code(500).send({ error: 'Failed to process CSV file' });
    }
  });

  fastify.delete('/users/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    config: { rateLimit: RATE_LIMITS.ADMIN_DELETE }
  }, async (request, reply) => {
    const { id } = request.params as any;

    try {
      const user = request.user as any;
      if (user.userId === id) {
        return reply.code(400).send({ error: 'Cannot delete your own account' });
      }

      await prisma.user.delete({
        where: { id }
      });

      return { message: 'User deleted successfully' };
    } catch (err: any) {
      return reply.code(500).send({ error: 'Failed to delete user' });
    }
  });

  fastify.delete('/documents/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    config: { rateLimit: RATE_LIMITS.ADMIN_DELETE }
  }, async (request, reply) => {
    const { id } = request.params as any;

    try {
      const document = await prisma.document.findUnique({
        where: { id }
      });

      if (!document) {
        return reply.code(404).send({ error: 'Document not found' });
      }

      const metadata = document.metadata as any;
      if (metadata.filePath) {
        try {
          await fs.unlink(metadata.filePath);
        } catch (err) {
          console.warn('Failed to delete file:', err);
        }
      }

      await prisma.document.delete({
        where: { id }
      });

      return { message: 'Document deleted successfully' };
    } catch (err: any) {
      return reply.code(500).send({ error: 'Failed to delete document' });
    }
  });

  fastify.delete('/institutions/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    config: { rateLimit: RATE_LIMITS.ADMIN_DELETE }
  }, async (request, reply) => {
    const { id } = request.params as any;

    try {
      const institution = await prisma.institution.findUnique({
        where: { id },
        include: {
          users: true,
          documents: true
        }
      });

      if (!institution) {
        return reply.code(404).send({ error: 'Institution not found' });
      }

      for (const doc of institution.documents) {
        const metadata = doc.metadata as any;
        if (metadata.filePath) {
          try {
            await fs.unlink(metadata.filePath);
          } catch (err) {
            console.warn('Failed to delete file:', err);
          }
        }
      }

      await prisma.institution.delete({
        where: { id }
      });

      return { 
        message: 'Institution deleted successfully',
        deletedUsers: institution.users.length,
        deletedDocuments: institution.documents.length
      };
    } catch (err: any) {
      return reply.code(500).send({ error: 'Failed to delete institution' });
    }
  });

  fastify.post('/cleanup-files', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    config: { rateLimit: RATE_LIMITS.ADMIN_WRITE }
  }, async (request, reply) => {
    const user = request.user as any;

    try {
      const uploadsDir = path.join(process.cwd(), 'uploads');
      
      const documents = await prisma.document.findMany({
        select: { metadata: true }
      });

      const dbFilePaths = new Set(
        documents.map((doc: any) => doc.metadata.filePath).filter(Boolean)
      );

      const files = await fs.readdir(uploadsDir).catch(() => []);
      const beforeCount = files.length;

      let orphanedCount = 0;

      for (const file of files) {
        const filePath = path.join(uploadsDir, file);
        
        if (!dbFilePaths.has(filePath)) {
          await fs.unlink(filePath);
          orphanedCount++;
        }
      }

      await prisma.auditLog.create({
        data: {
          userId: user.userId,
          action: 'files_cleanup',
          resource: 'System',
          details: { orphanedCount, beforeCount, afterCount: beforeCount - orphanedCount },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          success: true
        }
      }).catch(() => {});

      return {
        success: true,
        orphanedCount,
        beforeCount,
        afterCount: beforeCount - orphanedCount,
        message: `Cleaned up ${orphanedCount} orphaned file(s)`
      };
    } catch (error: any) {
      return reply.code(500).send({ error: 'Cleanup failed' });
    }
  });
}
