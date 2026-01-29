import { FastifyInstance } from 'fastify';
import { DocumentService } from '../services/document.service.js';
import { VerificationService } from '../services/verification.service.js';
import { prisma } from '../lib/prisma.js';
import { requireIssuerOrAdmin } from '../middleware/roleCheck.js';
import { EmailService } from '../services/email.service.js';
import path from 'path';
import fs from 'fs/promises';

export async function documentRoutes(fastify: FastifyInstance) {
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const user = request.user as any;
    const documents = await prisma.document.findMany({
      where: { userId: user.userId },
      include: { institution: true },
      orderBy: { issuedAt: 'desc' }
    });
    return { documents };
  });

  fastify.get('/:id', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { id } = request.params as any;
    const user = request.user as any;
    const document = await DocumentService.getDocument(id, user.userId);
    return { document };
  });

  fastify.post('/upload', {
    onRequest: [fastify.authenticate, requireIssuerOrAdmin]
  }, async (request, reply) => {
    const user = request.user as any;
    
    try {
      const parts = request.parts();
      let documentType = 'Document';
      let recipientEmail = user.email; // Default: issue to self
      let fileData: any = null;

      for await (const part of parts) {
        if (part.type === 'field' && part.fieldname === 'documentType') {
          documentType = part.value as string;
        } else if (part.type === 'field' && part.fieldname === 'recipientEmail') {
          recipientEmail = part.value as string;
        } else if (part.type === 'file' && part.fieldname === 'file') {
          if (part.mimetype !== 'application/pdf') {
            return reply.code(400).send({ error: 'Only PDF files allowed' });
          }
          fileData = {
            buffer: await part.toBuffer(),
            filename: part.filename
          };
        }
      }

      if (!fileData) {
        return reply.code(400).send({ error: 'No file uploaded' });
      }

      // Find recipient
      const recipient = await prisma.user.findUnique({
        where: { email: recipientEmail }
      });

      if (!recipient) {
        return reply.code(400).send({ error: 'Recipient not found' });
      }

      const document = await DocumentService.uploadDocument(
        user.userId,
        recipient.id,
        fileData.buffer,
        fileData.filename,
        documentType
      );

      // Send email notification
      await EmailService.sendDocumentIssued(
        recipient.email,
        documentType,
        document.institution.name
      );

      return { document };
    } catch (error: any) {
      fastify.log.error(error);
      if (error.statusCode === 413 || error.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'File too large (max 50MB)' });
      }
      return reply.code(500).send({ error: error.message || 'Upload failed' });
    }
  });

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, requireIssuerOrAdmin]
  }, async (request, reply) => {
    const { id } = request.params as any;
    const user = request.user as any;

    try {
      const document = await prisma.document.findUnique({
        where: { id },
        include: { user: true }
      });

      if (!document) {
        return reply.code(404).send({ error: 'Document not found' });
      }

      if (user.role === 'ISSUER' && document.institutionId !== user.institutionId) {
        return reply.code(403).send({ error: 'You can only delete documents from your institution' });
      }

      const metadata = document.metadata as any;
      const filePath = path.join(process.cwd(), 'uploads', metadata.fileName);
      
      try {
        await fs.unlink(filePath);
        console.log('🗑️ Deleted file:', metadata.fileName);
      } catch (err) {
        console.warn('⚠️ File already deleted:', metadata.fileName);
      }

      await prisma.document.delete({ where: { id } });

      console.log('✅ Document deleted:', id);

      return { message: 'Document deleted successfully' };
    } catch (error: any) {
      console.error('❌ Delete error:', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  fastify.get('/:id/download', async (request, reply) => {
    const { id } = request.params as any;
    const query = request.query as any;
    
    let userId: string;
    
    if (query.token) {
      try {
        const decoded = await fastify.jwt.verify(query.token) as any;
        userId = decoded.userId;
      } catch (err) {
        return reply.code(401).send({ error: 'Invalid token' });
      }
    } else {
      try {
        await request.jwtVerify();
        const user = request.user as any;
        userId = user.userId;
      } catch (err) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    }
    
    try {
      const document = await prisma.document.findUnique({
        where: { id },
        include: { user: true }
      });

      if (!document || document.userId !== userId) {
        return reply.code(404).send({ error: 'Document not found' });
      }

      const metadata = document.metadata as any;
      const filePath = path.join(process.cwd(), 'uploads', metadata.fileName);
      const fileBuffer = await fs.readFile(filePath);

      const originalName = metadata.originalName || 'document.pdf';
      const encodedFilename = encodeURIComponent(originalName);
      
      return reply
        .header('Access-Control-Allow-Origin', 'http://localhost:3001')
        .header('Access-Control-Allow-Credentials', 'true')
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`)
        .send(fileBuffer);
        
    } catch (error: any) {
      console.error('❌ Download error:', error.message);
      return reply.code(404).send({ error: error.message });
    }
  });

  fastify.post('/:id/verify', async (request, reply) => {
    const { id } = request.params as any;
    
    try {
      const document = await prisma.document.findUnique({
        where: { id }
      });

      if (!document) {
        return reply.code(404).send({ error: 'Document not found' });
      }

      const metadata = document.metadata as any;
      const filePath = path.join(process.cwd(), 'uploads', metadata.fileName);
      const fileBuffer = await fs.readFile(filePath);

      const result = await VerificationService.verifyDocument(id, fileBuffer);

      return result;
    } catch (error: any) {
      return reply.code(500).send({ error: error.message });
    }
  });

  // Revoke document
  fastify.post('/:id/revoke', {
    onRequest: [fastify.authenticate, requireIssuerOrAdmin]
  }, async (request, reply) => {
    const { id } = request.params as any;
    const { reason } = request.body as any;
    const user = request.user as any;

    try {
      const document = await prisma.document.findUnique({
        where: { id }
      });

      if (!document) {
        return reply.code(404).send({ error: 'Document not found' });
      }

      if (user.role === 'ISSUER' && document.institutionId !== user.institutionId) {
        return reply.code(403).send({ error: 'Can only revoke documents from your institution' });
      }

      // Update document status
      await prisma.document.update({
        where: { id },
        data: { status: 'REVOKED' }
      });

      // Create revocation record (persists even if document deleted)
      await prisma.revocation.create({
        data: {
          documentId: id,
          institutionId: document.institutionId,
          reason: reason || 'No reason provided',
          revokedBy: user.email
        }
      });

      return { message: 'Document revoked successfully' };
    } catch (error: any) {
      return reply.code(500).send({ error: error.message });
    }
  });
}
