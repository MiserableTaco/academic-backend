import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { KeyManagementService } from '../services/key-management.service.js';
import { EmailService } from '../services/email.service.js';
import { VerificationService } from '../services/verification.service.js';
import path from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import Papa from 'papaparse';

export async function documentRoutes(fastify: FastifyInstance) {
  // List documents
  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const user = request.user as any;

    const documents = await prisma.document.findMany({
      where: { userId: user.userId },
      include: {
        institution: true,
        user: true
      },
      orderBy: {
        issuedAt: 'desc'
      }
    });

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
      include: {
        institution: true,
        user: true
      }
    });

    if (!document) {
      return reply.code(404).send({ error: 'Document not found' });
    }

    if (document.userId !== user.userId && user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Access denied' });
    }

    return { document };
  });

  // Single document upload
  fastify.post('/upload', {
    onRequest: [fastify.authenticate, fastify.requireIssuerOrAdmin]
  }, async (request, reply) => {
    const user = request.user as any;

    try {
      const parts = request.parts();
      let file: any = null;
      let documentType = 'Document';
      let recipientEmail = user.email;

      for await (const part of parts) {
        if (part.type === 'file') {
          file = part;
        } else if (part.fieldname === 'documentType') {
          documentType = (part as any).value;
        } else if (part.fieldname === 'recipientEmail') {
          recipientEmail = (part as any).value;
        }
      }

      if (!file) {
        return reply.code(400).send({ error: 'No file uploaded' });
      }

      // Find recipient
      const recipient = await prisma.user.findUnique({
        where: { email: recipientEmail }
      });

      if (!recipient) {
        return reply.code(404).send({ error: `Recipient not found: ${recipientEmail}` });
      }

      // Check institution match
      if (user.role === 'ISSUER' && recipient.institutionId !== user.institutionId) {
        return reply.code(403).send({ error: 'Can only issue to students in your institution' });
      }

      const institution = await prisma.institution.findUnique({
        where: { id: user.institutionId }
      });

      if (!institution) {
        return reply.code(404).send({ error: 'Institution not found' });
      }

      const fileName = `${crypto.randomUUID()}.pdf`;
      const uploadsDir = path.join(process.cwd(), 'uploads');
      await fs.mkdir(uploadsDir, { recursive: true });

      const filePath = path.join(uploadsDir, fileName);
      await pipeline(file.file, createWriteStream(filePath));

      const fileBuffer = await fs.readFile(filePath);
      const { signature, hash } = KeyManagementService.signDocument(
        fileBuffer,
        institution.rootPrivateKey,
        institution.keyVersion
      );

      const document = await prisma.document.create({
        data: {
          type: documentType,
          userId: recipient.id,
          institutionId: institution.id,
          status: 'ACTIVE',
          metadata: {
            fileName,
            fileSize: fileBuffer.length,
            originalName: file.filename,
            signature,
            hash,
            algorithm: 'RSA-PSS-SHA256',
            keyVersion: institution.keyVersion,
            issuerId: user.userId,
            issuerEmail: user.email
          }
        },
        include: {
          institution: true,
          user: true
        }
      });

      await EmailService.sendDocumentIssued(
        recipient.email,
        documentType,
        institution.name
      );

      console.log(`📥 Document uploaded: ${documentType} for ${recipient.email}`);

      return { document };
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // Bulk document upload
  fastify.post('/bulk-upload', {
    onRequest: [fastify.authenticate, fastify.requireIssuerOrAdmin]
  }, async (request, reply) => {
    const user = request.user as any;

    try {
      const parts = request.parts();
      let zipFile: any = null;
      let csvFile: any = null;

      for await (const part of parts) {
        if (part.type === 'file') {
          if (part.fieldname === 'zipFile') {
            zipFile = part;
          } else if (part.fieldname === 'csvFile') {
            csvFile = part;
          }
        }
      }

      if (!zipFile || !csvFile) {
        return reply.code(400).send({ error: 'Both ZIP and CSV files are required' });
      }

      // Save ZIP temporarily
      const tempZipPath = path.join(process.cwd(), 'uploads', `temp-${crypto.randomUUID()}.zip`);
      await pipeline(zipFile.file, createWriteStream(tempZipPath));

      // Read CSV
      const csvBuffer = await csvFile.toBuffer();
      const csvText = csvBuffer.toString('utf-8');

      const parsed = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true
      });

      // Extract ZIP
      const zip = new AdmZip(tempZipPath);
      const zipEntries = zip.getEntries();

      const results = {
        total: 0,
        successful: 0,
        failed: 0,
        errors: [] as any[]
      };

      const institution = await prisma.institution.findUnique({
        where: { id: user.institutionId }
      });

      if (!institution) {
        return reply.code(404).send({ error: 'Institution not found' });
      }

      // Process each row
      for (const row of parsed.data as any[]) {
        results.total++;

        try {
          const { filename, studentEmail, documentType } = row;

          if (!filename || !studentEmail || !documentType) {
            results.failed++;
            results.errors.push({ row, error: 'Missing required fields' });
            continue;
          }

          // Find student
          const recipient = await prisma.user.findUnique({
            where: { email: studentEmail.trim() }
          });

          if (!recipient) {
            results.failed++;
            results.errors.push({ row, error: `Student not found: ${studentEmail}` });
            continue;
          }

          // Check institution match
          if (user.role === 'ISSUER' && recipient.institutionId !== user.institutionId) {
            results.failed++;
            results.errors.push({ row, error: `Student not in your institution: ${studentEmail}` });
            continue;
          }

          // Find file in ZIP
          const zipEntry = zipEntries.find(entry => entry.entryName === filename.trim());

          if (!zipEntry) {
            results.failed++;
            results.errors.push({ row, error: `File not found in ZIP: ${filename}` });
            continue;
          }

          // Extract file
          const fileBuffer = zipEntry.getData();

          if (!fileBuffer || fileBuffer.length === 0) {
            results.failed++;
            results.errors.push({ row, error: `Could not read file: ${filename}` });
            continue;
          }

          // Save file
          const savedFileName = `${crypto.randomUUID()}.pdf`;
          const uploadsDir = path.join(process.cwd(), 'uploads');
          await fs.mkdir(uploadsDir, { recursive: true });
          const filePath = path.join(uploadsDir, savedFileName);
          await fs.writeFile(filePath, fileBuffer);

          // Sign document
          const { signature, hash } = KeyManagementService.signDocument(
            fileBuffer,
            institution.rootPrivateKey,
            institution.keyVersion
          );

          // Create document
          await prisma.document.create({
            data: {
              type: documentType.trim(),
              userId: recipient.id,
              institutionId: institution.id,
              status: 'ACTIVE',
              metadata: {
                fileName: savedFileName,
                fileSize: fileBuffer.length,
                originalName: filename,
                signature,
                hash,
                algorithm: 'RSA-PSS-SHA256',
                keyVersion: institution.keyVersion,
                issuerId: user.userId,
                issuerEmail: user.email
              }
            }
          });

          // Send email notification
          await EmailService.sendDocumentIssued(
            recipient.email,
            documentType.trim(),
            institution.name
          );

          results.successful++;
          console.log(`✅ Bulk issued: ${documentType} to ${studentEmail}`);

        } catch (err: any) {
          results.failed++;
          results.errors.push({ row, error: err.message });
          console.error(`❌ Bulk upload error:`, err);
        }
      }

      // Cleanup temp ZIP
      try {
        await fs.unlink(tempZipPath);
      } catch (err) {
        console.warn('Could not delete temp ZIP:', err);
      }

      // Log audit
      await prisma.auditLog.create({
        data: {
          userId: user.userId,
          action: 'bulk_document_upload',
          resource: 'Document',
          details: results,
          success: true
        }
      });

      console.log(`📦 Bulk upload complete: ${results.successful}/${results.total} successful`);

      return results;
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
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

    if (document.userId !== user.userId && user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const metadata = document.metadata as any;
    const filePath = path.join(process.cwd(), 'uploads', metadata.fileName);

    try {
      const file = await fs.readFile(filePath);
      const originalName = metadata.originalName || 'document.pdf';
      const encodedFilename = encodeURIComponent(originalName);

      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${originalName}"; filename*=UTF-8''${encodedFilename}`)
        .send(file);
    } catch (error) {
      return reply.code(404).send({ error: 'File not found' });
    }
  });

  // Verify document
  fastify.post('/:id/verify', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params as any;

    const document = await prisma.document.findUnique({
      where: { id }
    });

    if (!document) {
      return reply.code(404).send({ error: 'Document not found' });
    }

    const metadata = document.metadata as any;
    const filePath = path.join(process.cwd(), 'uploads', metadata.fileName);

    try {
      const fileBuffer = await fs.readFile(filePath);
      const result = await VerificationService.verifyDocument(id, fileBuffer);
      return result;
    } catch (error: any) {
      return reply.code(500).send({ error: error.message });
    }
  });

  // Delete document
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, fastify.requireIssuerOrAdmin]
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

      if (user.role === 'ISSUER') {
        const metadata = document.metadata as any;
        if (metadata.issuerId !== user.userId) {
          return reply.code(403).send({ error: 'Can only delete documents you issued' });
        }
      }

      const metadata = document.metadata as any;
      const filePath = path.join(process.cwd(), 'uploads', metadata.fileName);

      try {
        await fs.unlink(filePath);
        console.log('🗑️  Deleted file:', metadata.fileName);
      } catch (err) {
        console.warn('⚠️  File already deleted:', metadata.fileName);
      }

      await prisma.document.delete({ where: { id } });

      console.log('✅ Document deleted:', id);

      return { message: 'Document deleted successfully' };
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });
}
