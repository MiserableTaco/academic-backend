import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireAdmin } from '../middleware/roleCheck.js';
import Papa from 'papaparse';
import path from 'path';
import fs from 'fs/promises';

export async function adminRoutes(fastify: FastifyInstance) {
  // Get stats
  fastify.get('/stats', {
    onRequest: [fastify.authenticate, requireAdmin]
  }, async () => {
    const [userCount, documentCount, institutionCount, recentAuditCount] = await Promise.all([
      prisma.user.count(),
      prisma.document.count(),
      prisma.institution.count(),
      prisma.auditLog.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
          }
        }
      })
    ]);

    return {
      users: userCount,
      documents: documentCount,
      institutions: institutionCount,
      recentAudits: recentAuditCount
    };
  });

  // Get all users
  fastify.get('/users', {
    onRequest: [fastify.authenticate, requireAdmin]
  }, async () => {
    const users = await prisma.user.findMany({
      include: {
        institution: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return { users };
  });

  // Get all documents
  fastify.get('/documents', {
    onRequest: [fastify.authenticate, requireAdmin]
  }, async () => {
    const documents = await prisma.document.findMany({
      include: {
        user: true,
        institution: true
      },
      orderBy: {
        issuedAt: 'desc'
      }
    });

    return { documents };
  });

  // Get all institutions
  fastify.get('/institutions', {
    onRequest: [fastify.authenticate, requireAdmin]
  }, async () => {
    const institutions = await prisma.institution.findMany({
      orderBy: {
        createdAt: 'desc'
      }
    });

    return { institutions };
  });

  // Get audit logs
  fastify.get('/audit-logs', {
    onRequest: [fastify.authenticate, requireAdmin]
  }, async (request) => {
    const { limit = 100 } = request.query as any;

    const logs = await prisma.auditLog.findMany({
      include: {
        user: {
          select: {
            email: true,
            role: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: parseInt(limit)
    });

    return { logs };
  });

  // Get security events
  fastify.get('/security-events', {
    onRequest: [fastify.authenticate, requireAdmin]
  }, async () => {
    const events = await prisma.auditLog.findMany({
      where: {
        OR: [
          { success: false },
          { action: { contains: 'failed' } },
          { action: { contains: 'revoke' } }
        ]
      },
      include: {
        user: {
          select: {
            email: true,
            role: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 50
    });

    return { events };
  });

  // Delete user
  fastify.delete('/users/:id', {
    onRequest: [fastify.authenticate, requireAdmin]
  }, async (request, reply) => {
    const { id } = request.params as any;
    const adminUser = request.user as any;

    try {
      const user = await prisma.user.findUnique({
        where: { id },
        include: {
          documents: true
        }
      });

      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Prevent deleting yourself
      if (user.id === adminUser.userId) {
        return reply.code(400).send({ error: 'Cannot delete your own account' });
      }

      // Delete associated documents first
      for (const doc of user.documents) {
        const metadata = doc.metadata as any;
        const filePath = path.join(process.cwd(), 'uploads', metadata.fileName);
        
        try {
          await fs.unlink(filePath);
        } catch (err) {
          console.warn('⚠️ File already deleted:', metadata.fileName);
        }
      }

      // Delete user (cascade will handle documents, OTP codes, audit logs)
      await prisma.user.delete({ where: { id } });

      // Log audit
      await prisma.auditLog.create({
        data: {
          userId: adminUser.userId,
          action: 'user_delete',
          resource: 'User',
          resourceId: id,
          details: { email: user.email, role: user.role },
          success: true
        }
      });

      console.log('✅ Admin deleted user:', user.email);

      return { message: 'User deleted successfully' };
    } catch (error: any) {
      console.error('❌ Admin user delete error:', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // Delete institution
  fastify.delete('/institutions/:id', {
    onRequest: [fastify.authenticate, requireAdmin]
  }, async (request, reply) => {
    const { id } = request.params as any;
    const adminUser = request.user as any;

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

      // Check if admin belongs to this institution
      const admin = await prisma.user.findUnique({
        where: { id: adminUser.userId }
      });

      if (admin?.institutionId === id) {
        return reply.code(400).send({ error: 'Cannot delete your own institution' });
      }

      // Delete all document files
      for (const doc of institution.documents) {
        const metadata = doc.metadata as any;
        const filePath = path.join(process.cwd(), 'uploads', metadata.fileName);
        
        try {
          await fs.unlink(filePath);
        } catch (err) {
          console.warn('⚠️ File already deleted:', metadata.fileName);
        }
      }

      // Delete institution (cascade will handle users, documents, revocations)
      await prisma.institution.delete({ where: { id } });

      // Log audit
      await prisma.auditLog.create({
        data: {
          userId: adminUser.userId,
          action: 'institution_delete',
          resource: 'Institution',
          resourceId: id,
          details: { 
            name: institution.name, 
            userCount: institution.users.length,
            documentCount: institution.documents.length 
          },
          success: true
        }
      });

      console.log('✅ Admin deleted institution:', institution.name);

      return { message: 'Institution deleted successfully' };
    } catch (error: any) {
      console.error('❌ Admin institution delete error:', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // Delete document
  fastify.delete('/documents/:id', {
    onRequest: [fastify.authenticate, requireAdmin]
  }, async (request, reply) => {
    const { id } = request.params as any;
    const user = request.user as any;

    try {
      const document = await prisma.document.findUnique({
        where: { id }
      });

      if (!document) {
        return reply.code(404).send({ error: 'Document not found' });
      }

      const metadata = document.metadata as any;
      const filePath = path.join(process.cwd(), 'uploads', metadata.fileName);
      
      try {
        await fs.unlink(filePath);
        console.log('🗑️ Admin deleted file:', metadata.fileName);
      } catch (err) {
        console.warn('⚠️ File already deleted:', metadata.fileName);
      }

      await prisma.document.delete({ where: { id } });

      // Log audit
      await prisma.auditLog.create({
        data: {
          userId: user.userId,
          action: 'document_delete',
          resource: 'Document',
          resourceId: id,
          details: { documentType: document.type, reason: 'admin_action' },
          success: true
        }
      });

      console.log('✅ Admin deleted document:', id);

      return { message: 'Document deleted successfully' };
    } catch (error: any) {
      console.error('❌ Admin delete error:', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // Bulk upload via CSV
  fastify.post('/bulk-upload', {
    onRequest: [fastify.authenticate, requireAdmin]
  }, async (request, reply) => {
    const user = request.user as any;

    try {
      const data = await request.file();
      if (!data) {
        return reply.code(400).send({ error: 'No file uploaded' });
      }

      const buffer = await data.toBuffer();
      const csvText = buffer.toString('utf-8');

      const parsed = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true
      });

      const results = {
        total: 0,
        created: 0,
        failed: 0,
        errors: [] as any[]
      };

      for (const row of parsed.data as any[]) {
        results.total++;
        
        try {
          const { email, role, institutionName } = row;

          if (!email || !role || !institutionName) {
            results.failed++;
            results.errors.push({ row, error: 'Missing required fields' });
            continue;
          }

          const institution = await prisma.institution.findFirst({
            where: { name: institutionName }
          });

          if (!institution) {
            results.failed++;
            results.errors.push({ row, error: `Institution not found: ${institutionName}` });
            continue;
          }

          await prisma.user.upsert({
            where: { email },
            create: {
              email,
              institutionId: institution.id,
              role: role.toUpperCase(),
              verified: true
            },
            update: {
              role: role.toUpperCase()
            }
          });

          results.created++;
        } catch (err: any) {
          results.failed++;
          results.errors.push({ row, error: err.message });
        }
      }

      // Log audit
      await prisma.auditLog.create({
        data: {
          userId: user.userId,
          action: 'bulk_upload',
          resource: 'User',
          details: results,
          success: true
        }
      });

      return results;
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // System health check
  fastify.get('/health', {
    onRequest: [fastify.authenticate, requireAdmin]
  }, async () => {
    const [dbStatus, uploadsCount, recentErrors] = await Promise.all([
      prisma.$queryRaw`SELECT 1`
        .then(() => 'healthy')
        .catch(() => 'unhealthy'),
      fs.readdir(path.join(process.cwd(), 'uploads'))
        .then(files => files.length)
        .catch(() => 0),
      prisma.auditLog.count({
        where: {
          success: false,
          createdAt: {
            gte: new Date(Date.now() - 60 * 60 * 1000)
          }
        }
      })
    ]);

    return {
      database: dbStatus,
      uploads: uploadsCount,
      errors: recentErrors,
      timestamp: new Date().toISOString()
    };
  });
}
