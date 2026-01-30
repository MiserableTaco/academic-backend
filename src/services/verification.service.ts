import { prisma } from '../lib/prisma.js';
import { KeyManagementService } from './key-management.service.js';

export class VerificationService {
  static async verifyDocument(documentId: string, fileBuffer: Buffer) {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        institution: true,
        user: true
      }
    });

    if (!document) {
      return {
        valid: false,
        errors: ['Document not found in system'],
        checks: {
          signatureValid: false,
          authorityValid: false,
          notRevoked: false
        }
      };
    }

    const metadata = document.metadata as any;
    const errors: string[] = [];
    const checks = {
      signatureValid: false,
      authorityValid: false,
      notRevoked: false
    };

    // CRITICAL: Check revocation FIRST and EXPLICITLY
    const revocation = await prisma.revocation.findUnique({
      where: { documentId: document.id }
    });

    if (document.status === 'REVOKED' || revocation) {
      checks.notRevoked = false;
      errors.push('Document has been revoked and is no longer valid');
      // CRITICAL: Return early with revoked status (not generic "invalid")
      return {
        valid: false,
        status: 'REVOKED',
        revokedAt: revocation?.revokedAt,
        revokedBy: revocation?.revokedBy,
        reason: revocation?.reason,
        errors,
        checks
      };
    }

    if (document.status === 'SUPERSEDED') {
      checks.notRevoked = false;
      errors.push('Document has been superseded by a newer version');
      return {
        valid: false,
        status: 'SUPERSEDED',
        errors,
        checks
      };
    }

    checks.notRevoked = true;

    // Verify cryptographic signature
    try {
      const isSignatureValid = KeyManagementService.verifyDocument(
        fileBuffer,
        metadata.signature,
        document.institution.rootPublicKey,
        metadata.hash
      );

      checks.signatureValid = isSignatureValid;

      if (!isSignatureValid) {
        errors.push('Cryptographic signature verification failed');
      }
    } catch (err: any) {
      checks.signatureValid = false;
      errors.push(`Signature verification error: ${err.message}`);
    }

    // Verify issuing authority
    if (document.institution.status !== 'ACTIVE') {
      checks.authorityValid = false;
      errors.push('Issuing institution is no longer active');
    } else {
      checks.authorityValid = true;
    }

    return {
      valid: checks.signatureValid && checks.authorityValid && checks.notRevoked,
      status: document.status,
      checks,
      errors: errors.length > 0 ? errors : undefined,
      document: {
        id: document.id,
        type: document.type,
        issuedTo: document.user.email,
        issuedBy: document.institution.name,
        issuedAt: document.issuedAt,
        algorithm: metadata.algorithm,
        keyVersion: metadata.keyVersion
      }
    };
  }
}
