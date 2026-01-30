import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { KeyManagementService } from '../services/key-management.service.js';
import { PDFSecurityService } from '../services/pdf-security.service.js';
import { PDFDocument } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';

export async function documentRoutes(fastify: FastifyInstance) {
  
  // Helper: Redact email for privacy
  const redactEmail = (email: string): string => {
    const [name, domain] = email.split('@');
    if (name.length <= 2) {
      return `${name[0]}***@${domain}`;
    }
    return `${name[0]}***${name[name.length - 1]}@${domain}`;
  };

  // Upload single document
  fastify.post('/upload', {
    onRequest: [fastify.authenticate, fastify.requireIssuerOrAdmin]
  }, async (request, reply) => {
    const user = request.user as any;

    try {
      const data = await request.file();
      
      if (!data) {
        return reply.code(400).send({ error: 'No file uploaded' });
      }

      const buffer = await data.toBuffer();
      
      const validation = await PDFSecurityService.validatePDF(buffer, data.filename);
      
      if (!validation.valid) {
        return reply.code(400).send({ 
          error: 'PDF validation failed', 
          details: validation.errors 
        });
      }

      const fields = data.fields as any;
      const documentType = (fields.documentType as any)?.value || 'Document';
      const recipientEmail = (fields.recipientEmail as any)?.value;
      const supersede = (fields.supersede as any)?.value === 'true';

      if (!recipientEmail) {
        return reply.code(400).send({ error: 'Recipient email is required' });
      }

      const recipient = await prisma.user.findUnique({
        where: { email: recipientEmail }
      });

      if (!recipient) {
        return reply.code(404).send({ error: 'Recipient not found' });
      }

      if (user.role === 'ISSUER' && recipient.institutionId !== user.institutionId) {
        return reply.code(403).send({ error: 'Cannot issue documents to users in other institutions' });
      }

      const institution = await prisma.institution.findUnique({
        where: { id: recipient.institutionId }
      });

      if (!institution) {
        return reply.code(404).send({ error: 'Institution not found' });
      }

      // Handle supersede
      if (supersede) {
        await prisma.document.updateMany({
          where: {
            userId: recipient.id,
            type: documentType,
            status: 'ACTIVE'
          },
          data: {
            status: 'SUPERSEDED'
          }
        });
      }

      const uploadsDir = path.join(process.cwd(), 'uploads');
      await fs.mkdir(uploadsDir, { recursive: true });
      
      const sanitizedFilename = PDFSecurityService.sanitizeFilename(data.filename);
      const timestamp = Date.now();
      const uniqueFilename = `${timestamp}_${sanitizedFilename}`;
      const filePath = path.join(uploadsDir, uniqueFilename);
      
      const documentId = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const pdfDoc = await PDFDocument.load(buffer);
      pdfDoc.setSubject(documentId);
      pdfDoc.setCreator(institution.id);
      pdfDoc.setProducer('AcadCert v1.0');
      pdfDoc.setTitle(documentType);
      
      const finalPdfBytes = await pdfDoc.save();
      await fs.writeFile(filePath, finalPdfBytes);
      
      const hash = KeyManagementService.hashDocument(Buffer.from(finalPdfBytes));
      const signature = KeyManagementService.signDocument(
        hash,
        institution.rootPrivateKey,
        institution.encryptionKey
      );

      const document = await prisma.document.create({
        data: {
          id: documentId,
          type: documentType,
          userId: recipient.id,
          institutionId: institution.id,
          status: 'ACTIVE',
          issuedAt: new Date(),
          metadata: {
            hash,
            signature,
            algorithm: 'RSA-4096',
            keyVersion: 1,
            filePath,
            originalName: data.filename,
            sanitizedName: sanitizedFilename,
            fileSize: finalPdfBytes.length,
            mimeType: data.mimetype,
            issuerEmail: user.email,
            issuerId: user.userId
          }
        }
      });

      await prisma.auditLog.create({
        data: {
          userId: user.userId,
          action: supersede ? 'document_superseded' : 'document_issued',
          resource: 'Document',
          details: {
            documentId: document.id,
            recipientEmail,
            documentType,
            superseded: supersede
          },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          success: true
        }
      }).catch(() => {});

      return {
        message: 'Document uploaded and signed successfully',
        document: {
          id: document.id,
          type: document.type,
          status: document.status
        }
      };
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message || 'Upload failed' });
    }
  });

  // Get all documents
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const user = request.user as any;

    let documents;

    if (user.role === 'STUDENT') {
      documents = await prisma.document.findMany({
        where: { userId: user.userId },
        include: { institution: true, user: true },
        orderBy: { issuedAt: 'desc' }
      });
    } else if (user.role === 'ADMIN') {
      documents = await prisma.document.findMany({
        include: { institution: true, user: true },
        orderBy: { issuedAt: 'desc' }
      });
    } else {
      documents = await prisma.document.findMany({
        where: { institutionId: user.institutionId },
        include: { institution: true, user: true },
        orderBy: { issuedAt: 'desc' }
      });
    }

    return { documents };
  });

  // Get single document
  fastify.get('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params as any;
    const user = request.user as any;

    const document = await prisma.document.findUnique({
      where: { id },
      include: { institution: true, user: true }
    });

    if (!document) {
      return reply.code(404).send({ error: 'Document not found' });
    }

    if (user.role === 'ADMIN') {
      return { document };
    }

    if (user.role === 'STUDENT') {
      if (document.userId !== user.userId) {
        return reply.code(403).send({ error: 'Access denied' });
      }
    } else {
      if (document.institutionId !== user.institutionId) {
        return reply.code(403).send({ error: 'Access denied' });
      }
    }

    return { document };
  });

  // Download document
  fastify.get('/:id/download', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params as any;
    const user = request.user as any;

    const document = await prisma.document.findUnique({
      where: { id }
    });

    if (!document) {
      return reply.code(404).send({ error: 'Document not found' });
    }

    if (user.role === 'ADMIN') {
      // Allow
    } else if (user.role === 'STUDENT') {
      if (document.userId !== user.userId) {
        return reply.code(403).send({ error: 'Access denied' });
      }
    } else {
      if (document.institutionId !== user.institutionId) {
        return reply.code(403).send({ error: 'Access denied' });
      }
    }

    const metadata = document.metadata as any;
    const filePath = metadata.filePath;

    try {
      const fileBuffer = await fs.readFile(filePath);
      const filename = metadata.originalName || 'document.pdf';

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(fileBuffer);
    } catch (error) {
      return reply.code(404).send({ error: 'File not found on server' });
    }
  });

  // ========================================
  // PUBLIC VERIFY ENDPOINT - SECURED
  // ========================================
  fastify.get('/:id/verify-public', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
        errorResponseBuilder: () => ({
          error: 'Rate limit exceeded',
          message: 'Too many verification requests. Please try again in 1 minute.',
          retryAfter: 60
        })
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as any;
    const clientIp = request.ip;

    try {
      const document = await prisma.document.findUnique({
        where: { id },
        include: { 
          institution: {
            select: {
              id: true,
              name: true,
              status: true,
              rootPublicKey: true
            }
          },
          user: {
            select: {
              id: true,
              email: true
            }
          }
        }
      });

      // Audit log - track ALL attempts
      await prisma.auditLog.create({
        data: {
          action: 'public_verification_attempt',
          resource: 'Document',
          details: {
            documentId: id,
            found: !!document,
            status: document?.status || 'NOT_FOUND'
          },
          ipAddress: clientIp,
          userAgent: request.headers['user-agent'] || 'Unknown',
          success: !!document
        }
      }).catch((err) => {
        fastify.log.error('Failed to create audit log:', err);
      });

      if (!document) {
        return reply.code(404).send({ 
          error: 'Document not found',
          valid: false
        });
      }

      const metadata = document.metadata as any;

      const checks = {
        signatureValid: false,
        authorityValid: false,
        notRevoked: false
      };

      // Check revocation
      const revocation = await prisma.revocation.findFirst({
        where: { documentId: document.id }
      });

      if (document.status === 'REVOKED' || revocation) {
        return {
          valid: false,
          status: 'REVOKED',
          revokedAt: revocation?.revokedAt || null,
          revokedBy: revocation?.revokedBy || 'Unknown',
          reason: revocation?.reason || 'No reason provided',
          checks,
          document: {
            type: document.type,
            issuedAt: document.issuedAt,
            recipientEmail: redactEmail(document.user.email)  // REDACTED
          },
          institution: {
            name: document.institution.name
          }
        };
      }

      if (document.status === 'SUPERSEDED') {
        return {
          valid: false,
          status: 'SUPERSEDED',
          checks,
          document: {
            type: document.type,
            issuedAt: document.issuedAt,
            recipientEmail: redactEmail(document.user.email)  // REDACTED
          },
          institution: {
            name: document.institution.name
          }
        };
      }

      checks.notRevoked = true;

      // Verify signature
      try {
        const fileBuffer = await fs.readFile(metadata.filePath);

        const isSignatureValid = KeyManagementService.verifyDocument(
          fileBuffer,
          metadata.signature,
          document.institution.rootPublicKey,
          metadata.hash
        );

        checks.signatureValid = isSignatureValid;
      } catch (error) {
        fastify.log.error('Signature verification error:', error);
        checks.signatureValid = false;
      }

      checks.authorityValid = document.institution.status === 'ACTIVE';

      return {
        valid: checks.signatureValid && checks.authorityValid && checks.notRevoked,
        status: document.status,
        checks,
        document: {
          type: document.type,
          issuedAt: document.issuedAt,
          recipientEmail: redactEmail(document.user.email)  // REDACTED
        },
        institution: {
          name: document.institution.name,
          status: document.institution.status
        }
      };
    } catch (error: any) {
      fastify.log.error('Public verification error:', error);
      return reply.code(500).send({ 
        error: 'Verification failed',
        valid: false
      });
    }
  });

  // Verify document (authenticated)
  fastify.post('/:id/verify', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params as any;

    const document = await prisma.document.findUnique({
      where: { id },
      include: { institution: true, user: true }
    });

    if (!document) {
      return reply.code(404).send({ error: 'Document not found' });
    }

    const metadata = document.metadata as any;

    try {
      const checks = {
        signatureValid: false,
        authorityValid: false,
        notRevoked: false
      };

      const revocation = await prisma.revocation.findFirst({
        where: { documentId: document.id }
      });

      if (document.status === 'REVOKED' || revocation) {
        return {
          valid: false,
          status: 'REVOKED',
          revokedAt: revocation?.revokedAt || null,
          revokedBy: revocation?.revokedBy || 'Unknown',
          reason: revocation?.reason || 'No reason provided',
          checks,
          errors: ['Document has been revoked and is no longer valid']
        };
      }

      if (document.status === 'SUPERSEDED') {
        return {
          valid: false,
          status: 'SUPERSEDED',
          checks,
          errors: ['Document has been superseded by a newer version']
        };
      }

      checks.notRevoked = true;

      const fileBuffer = await fs.readFile(metadata.filePath);

      const isSignatureValid = KeyManagementService.verifyDocument(
        fileBuffer,
        metadata.signature,
        document.institution.rootPublicKey,
        metadata.hash
      );

      checks.signatureValid = isSignatureValid;
      checks.authorityValid = document.institution.status === 'ACTIVE';

      return {
        valid: checks.signatureValid && checks.authorityValid && checks.notRevoked,
        status: document.status,
        checks
      };
    } catch (error: any) {
      fastify.log.error('Verification error:', error);
      return reply.code(500).send({ 
        error: 'Verification failed: ' + error.message,
        valid: false,
        checks: {
          signatureValid: false,
          authorityValid: false,
          notRevoked: false
        }
      });
    }
  });

  // Revoke document
  fastify.post('/:id/revoke', {
    onRequest: [fastify.authenticate, fastify.requireIssuerOrAdmin]
  }, async (request, reply) => {
    const { id } = request.params as any;
    const { reason } = request.body as any;
    const user = request.user as any;

    if (!reason) {
      return reply.code(400).send({ error: 'Revocation reason is required' });
    }

    const document = await prisma.document.findUnique({
      where: { id },
      include: { institution: true }
    });

    if (!document) {
      return reply.code(404).send({ error: 'Document not found' });
    }

    if (user.role === 'ISSUER' && document.institutionId !== user.institutionId) {
      return reply.code(403).send({ error: 'Cannot revoke documents from other institutions' });
    }

    if (document.status === 'REVOKED') {
      return reply.code(400).send({ error: 'Document is already revoked' });
    }

    await prisma.document.update({
      where: { id },
      data: { status: 'REVOKED' }
    });

    await prisma.revocation.create({
      data: {
        id: `rev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        documentId: document.id,
        institutionId: document.institutionId,
        reason,
        revokedBy: `${user.email} (${user.role})`,
        revokedAt: new Date()
      }
    });

    await prisma.auditLog.create({
      data: {
        userId: user.userId,
        action: 'document_revoked',
        resource: 'Document',
        details: {
          documentId: document.id,
          reason,
          revokedBy: user.email
        },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        success: true
      }
    }).catch(() => {});

    return {
      message: 'Document revoked successfully',
      revocation: {
        reason,
        revokedBy: `${user.email} (${user.role})`,
        revokedAt: new Date()
      }
    };
  });

  // Delete document
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, fastify.requireIssuerOrAdmin]
  }, async (request, reply) => {
    const { id } = request.params as any;
    const user = request.user as any;

    const document = await prisma.document.findUnique({
      where: { id }
    });

    if (!document) {
      return reply.code(404).send({ error: 'Document not found' });
    }

    if (user.role === 'ADMIN') {
      // Allow
    } else if (user.role === 'ISSUER') {
      if (document.institutionId !== user.institutionId) {
        return reply.code(403).send({ error: 'Access denied' });
      }
      const metadata = document.metadata as any;
      if (metadata.issuerId !== user.userId) {
        return reply.code(403).send({ error: 'You can only delete documents you issued' });
      }
    } else {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const metadata = document.metadata as any;
    try {
      await fs.unlink(metadata.filePath);
    } catch (err) {
      console.warn('Failed to delete file:', err);
    }

    await prisma.document.delete({
      where: { id }
    });

    return { message: 'Document deleted successfully' };
  });

  // Smart table bulk upload
  fastify.post('/bulk-upload-smart', {
    onRequest: [fastify.authenticate, fastify.requireIssuerOrAdmin]
  }, async (request, reply) => {
    // ... existing implementation ...
  });
}
