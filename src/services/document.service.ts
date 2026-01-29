import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../lib/prisma.js';

export class DocumentService {
  static async uploadDocument(
    userId: string,
    file: Buffer,
    fileName: string,
    documentType: string
  ) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { institution: true }
    });

    if (!user || (user.role !== 'ISSUER' && user.role !== 'ADMIN')) {
      throw new Error('Not authorized to upload documents');
    }

    const fileId = crypto.randomUUID();
    const fileExt = path.extname(fileName);
    const storedFileName = `${fileId}${fileExt}`;
    const filePath = path.join(process.cwd(), 'uploads', storedFileName);

    await fs.writeFile(filePath, file);

    const fileHash = crypto.createHash('sha256').update(file).digest('hex');
    const signature = crypto.sign('sha256', Buffer.from(fileHash, 'hex'), {
      key: user.institution.privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
    });

    const document = await prisma.document.create({
      data: {
        userId,
        institutionId: user.institutionId,
        type: documentType,
        status: 'ACTIVE',
        issuedAt: new Date(),
        metadata: {
          fileName: storedFileName,
          originalName: fileName,
          fileHash,
          signature: signature.toString('base64'),
          fileSize: file.length,
          algorithm: 'RSA-PSS-SHA256'
        }
      },
      include: { institution: true, user: true }
    });

    console.log(`✅ Document signed: ${fileName}`);
    console.log(`📄 Hash: ${fileHash.substring(0, 16)}...`);
    console.log(`🔐 Signature algorithm: RSA-PSS with SHA-256\n`);

    return document;
  }

  static async getDocument(documentId: string, userId: string) {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { institution: true, user: true }
    });

    if (!document) throw new Error('Document not found');
    if (document.userId !== userId) throw new Error('Not authorized');

    return document;
  }

  static async getDocumentFile(documentId: string, userId: string) {
    const document = await this.getDocument(documentId, userId);
    const metadata = document.metadata as any;
    const filePath = path.join(process.cwd(), 'uploads', metadata.fileName);
    
    const fileBuffer = await fs.readFile(filePath);
    
    // Sanitize filename - remove special chars
    const originalName = metadata.originalName || 'document.pdf';
    const sanitizedName = originalName
      .replace(/[^\w\s.-]/g, '')  // Remove special chars
      .replace(/\s+/g, '_')       // Replace spaces with underscore
      .substring(0, 200);         // Limit length
    
    return { 
      buffer: fileBuffer, 
      fileName: sanitizedName 
    };
  }

  static verifyDocument(fileBuffer: Buffer, signature: string, publicKey: string): boolean {
    try {
      const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      
      const isValid = crypto.verify(
        'sha256',
        Buffer.from(fileHash, 'hex'),
        {
          key: publicKey,
          padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
          saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
        },
        Buffer.from(signature, 'base64')
      );

      return isValid;
    } catch (error) {
      console.error('Verification error:', error);
      return false;
    }
  }
}
