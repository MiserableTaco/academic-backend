import { prisma } from '../lib/prisma.js';
import { Platform, AccessAction } from '@prisma/client';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { EncryptionService } from './encryption.service.js';
import { DocumentService } from './document.service.js';

export class ExternalIntegrationService {
  /**
   * Create a shareable link for external platforms
   */
  static async createShare(
    documentId: string,
    userId: string,
    platform: Platform,
    options: {
      expiryDays?: number;
      allowDownload?: boolean;
    } = {}
  ): Promise<{
    shareUrl: string;
    qrCode?: string;
    platform: Platform;
  }> {
    // Verify user owns the document
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        userId,
      },
      include: {
        institution: true,
        user: true,
      },
    });

    if (!document) {
      throw new Error('Document not found or access denied');
    }

    if (document.revoked) {
      throw new Error('Cannot share a revoked document');
    }

    // Generate secure token
    const shareToken = crypto.randomBytes(32).toString('hex');

    // Calculate expiry
    const expiresAt = options.expiryDays
      ? new Date(Date.now() + options.expiryDays * 24 * 60 * 60 * 1000)
      : null;

    // Create share record
    const share = await prisma.externalShare.create({
      data: {
        documentId,
        platform,
        shareToken,
        expiresAt,
        allowDownload: options.allowDownload || false,
      },
    });

    // Generate share URL based on platform
    const baseUrl = process.env.CORS_ORIGIN || 'http://localhost:3001';
    let shareUrl: string;

    switch (platform) {
      case Platform.APPLE_WALLET:
        shareUrl = `${baseUrl}/wallet/${shareToken}`;
        break;
      case Platform.LINKEDIN:
        shareUrl = `${baseUrl}/linkedin/${shareToken}`;
        break;
      default:
        shareUrl = `${baseUrl}/verify/${shareToken}`;
    }

    // Generate QR code
    const qrCode = await QRCode.toDataURL(shareUrl);

    // Log share creation
    await prisma.accessLog.create({
      data: {
        actorId: userId,
        documentId,
        action: AccessAction.SHARE_CREATE,
        ipAddress: '0.0.0.0', // Will be set by route
        metadata: { platform, shareToken },
      },
    });

    return {
      shareUrl,
      qrCode,
      platform,
    };
  }

  /**
   * Access a shared document (for external viewers)
   */
  static async accessShare(
    shareToken: string,
    ipAddress: string
  ): Promise<{
    document: any;
    institution: any;
    valid: boolean;
    allowDownload: boolean;
  }> {
    const share = await prisma.externalShare.findUnique({
      where: { shareToken },
      include: {
        document: {
          include: {
            institution: true,
            user: {
              select: {
                email: true,
              },
            },
          },
        },
      },
    });

    if (!share) {
      throw new Error('Invalid verification link');
    }

    // Check expiry
    if (share.expiresAt && share.expiresAt < new Date()) {
      throw new Error('Verification link has expired');
    }

    // Check document revocation
    if (share.document.revoked) {
      return {
        document: {
          id: share.document.id,
          type: share.document.type,
          title: share.document.title,
          issuedAt: share.document.issuedAt,
          revoked: true,
          revokedReason: share.document.revokedReason,
        },
        institution: {
          name: share.document.institution.name,
        },
        valid: false,
        allowDownload: false,
      };
    }

    // Increment access count
    await prisma.externalShare.update({
      where: { id: share.id },
      data: { accessCount: share.accessCount + 1 },
    });

    // Log access
    await prisma.accessLog.create({
      data: {
        actorId: share.document.userId,
        documentId: share.documentId,
        action: AccessAction.SHARE_ACCESS,
        ipAddress,
        metadata: { platform: share.platform, shareToken },
      },
    });

    return {
      document: {
        id: share.document.id,
        type: share.document.type,
        title: share.document.title,
        issuedAt: share.document.issuedAt,
        hash: share.document.hashSha256,
        revoked: false,
      },
      institution: {
        name: share.document.institution.name,
        publicKey: share.document.institution.publicKey,
      },
      valid: true,
      allowDownload: share.allowDownload,
    };
  }

  /**
   * Generate Apple Wallet pass
   * Returns .pkpass file data
   */
  static async generateAppleWalletPass(
    shareToken: string
  ): Promise<{
    passData: any;
    format: 'pkpass';
  }> {
    const shareData = await this.accessShare(shareToken, '0.0.0.0');

    if (!shareData.valid) {
      throw new Error('Document is not valid for wallet creation');
    }

    // Apple Wallet pass structure
    const pass = {
      formatVersion: 1,
      passTypeIdentifier: 'pass.com.academic.verification',
      serialNumber: shareData.document.id,
      teamIdentifier: 'YOUR_TEAM_ID', // Configure in environment
      organizationName: shareData.institution.name,
      description: `${shareData.document.type} Certificate`,
      generic: {
        primaryFields: [
          {
            key: 'title',
            label: 'Document Type',
            value: shareData.document.type,
          },
        ],
        secondaryFields: [
          {
            key: 'institution',
            label: 'Issued By',
            value: shareData.institution.name,
          },
          {
            key: 'date',
            label: 'Issue Date',
            value: shareData.document.issuedAt,
          },
        ],
        auxiliaryFields: [
          {
            key: 'verified',
            label: 'Status',
            value: 'Verified ✓',
          },
        ],
        backFields: [
          {
            key: 'hash',
            label: 'Document Hash',
            value: shareData.document.hash,
          },
          {
            key: 'verification',
            label: 'Verification URL',
            value: `${process.env.CORS_ORIGIN}/verify/${shareToken}`,
          },
        ],
      },
      barcode: {
        message: shareToken,
        format: 'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1',
      },
      backgroundColor: 'rgb(0, 100, 200)',
      foregroundColor: 'rgb(255, 255, 255)',
      labelColor: 'rgb(200, 200, 200)',
    };

    return {
      passData: pass,
      format: 'pkpass',
    };
  }

  /**
   * Generate LinkedIn certificate data
   */
  static async generateLinkedInCertificate(
    shareToken: string
  ): Promise<{
    certificateData: any;
    verificationUrl: string;
  }> {
    const shareData = await this.accessShare(shareToken, '0.0.0.0');

    if (!shareData.valid) {
      throw new Error('Document is not valid for LinkedIn certification');
    }

    // LinkedIn Certification format
    const certificateData = {
      name: shareData.document.title || `${shareData.document.type} Certificate`,
      organization: shareData.institution.name,
      issueDate: shareData.document.issuedAt,
      credentialId: shareData.document.id,
      credentialUrl: `${process.env.CORS_ORIGIN}/verify/${shareToken}`,
      // Optional: Include skills/competencies from document metadata
      skills: shareData.document.metadata?.skills || [],
    };

    return {
      certificateData,
      verificationUrl: `${process.env.CORS_ORIGIN}/verify/${shareToken}`,
    };
  }

  /**
   * Verify document for external platforms
   * Returns verification status without full document access
   */
  static async verifyForExternal(
    shareToken: string,
    ipAddress: string
  ): Promise<{
    verified: boolean;
    institution: string;
    documentType: string;
    issuedDate: Date;
    revoked: boolean;
    hash: string;
  }> {
    const shareData = await this.accessShare(shareToken, ipAddress);

    return {
      verified: shareData.valid,
      institution: shareData.institution.name,
      documentType: shareData.document.type,
      issuedDate: shareData.document.issuedAt,
      revoked: shareData.document.revoked,
      hash: shareData.document.hash || '',
    };
  }

  /**
   * Download document via share link (if allowed)
   */
  static async downloadViaShare(
    shareToken: string,
    userId: string,
    ipAddress: string
  ): Promise<Buffer> {
    const share = await prisma.externalShare.findUnique({
      where: { shareToken },
      include: { document: true },
    });

    if (!share) {
      throw new Error('Invalid share link');
    }

    if (!share.allowDownload) {
      throw new Error('Download not permitted for this share link');
    }

    if (share.expiresAt && share.expiresAt < new Date()) {
      throw new Error('Share link has expired');
    }

    // Use DocumentService to verify and decrypt
    const result = await DocumentService.verifyDocument(
      share.documentId,
      userId,
      ipAddress
    );

    if (!result.valid || !result.decrypted) {
      throw new Error('Document verification failed');
    }

    return result.decrypted;
  }
}
