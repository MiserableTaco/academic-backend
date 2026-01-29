import { prisma } from '../lib/prisma.js';
import { KeyManagementService } from './key-management.service.js';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';

export class DocumentService {
  /**
   * Upload document - System signs on behalf of institution
   */
  static async uploadDocument(
    issuerId: string,
    recipientId: string,
    fileBuffer: Buffer,
    originalFilename: string,
    documentType: string
  ) {
    // Get issuer details
    const issuer = await prisma.user.findUnique({
      where: { id: issuerId },
      include: { institution: true }
    });

    if (!issuer) {
      throw new Error('Issuer not found');
    }

    if (issuer.role !== 'ISSUER' && issuer.role !== 'ADMIN') {
      throw new Error('Only issuers and admins can upload documents');
    }

    // Check issuer is not revoked
    if (issuer.revokedAt) {
      throw new Error('Issuer authorization has been revoked');
    }

    // Get recipient
    const recipient = await prisma.user.findUnique({
      where: { id: recipientId }
    });

    if (!recipient) {
      throw new Error('Recipient not found');
    }

    // Institution must match for ISSUER role
    if (issuer.role === 'ISSUER' && issuer.institutionId !== recipient.institutionId) {
      throw new Error('Cannot issue documents to users outside your institution');
    }

    // Generate unique filename
    const fileExtension = path.extname(originalFilename);
    const uniqueFilename = `${crypto.randomUUID()}${fileExtension}`;
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const filePath = path.join(uploadsDir, uniqueFilename);

    // Ensure uploads directory exists
    await fs.mkdir(uploadsDir, { recursive: true });

    // Save file
    await fs.writeFile(filePath, fileBuffer);

    // Sign document using INSTITUTION root key (not issuer key!)
    const { signature, hash } = KeyManagementService.signDocument(
      fileBuffer,
      issuer.institution.rootPrivateKey,
      issuer.institution.keyVersion
    );

    // Create document record
    const document = await prisma.document.create({
      data: {
        type: documentType,
        status: 'ACTIVE',
        userId: recipientId,
        institutionId: issuer.institutionId,
        metadata: {
          fileHash: hash,
          fileName: uniqueFilename,
          originalName: originalFilename,
          fileSize: fileBuffer.length,
          algorithm: 'RSA-PSS-SHA256',
          signature: signature,
          keyVersion: issuer.institution.keyVersion,
          issuerId: issuer.id,
          issuerEmail: issuer.email,
          issuedAt: new Date().toISOString()
        }
      },
      include: {
        institution: true,
        user: true
      }
    });

    return document;
  }

  static async getDocument(id: string, userId: string) {
    const document = await prisma.document.findFirst({
      where: {
        id,
        userId
      },
      include: {
        institution: true
      }
    });

    if (!document) {
      throw new Error('Document not found');
    }

    return document;
  }

  static async getDocumentFile(id: string, userId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const document = await this.getDocument(id, userId);
    const metadata = document.metadata as any;
    const filePath = path.join(process.cwd(), 'uploads', metadata.fileName);
    const buffer = await fs.readFile(filePath);

    return {
      buffer,
      fileName: metadata.originalName || 'document.pdf'
    };
  }
}
