import { prisma } from '../lib/prisma.js';
import { KeyManagementService } from './key-management.service.js';

export interface VerificationResult {
  valid: boolean;
  checks: {
    cryptographic: boolean;
    authority: boolean;
    revocation: boolean;
  };
  details: {
    documentType?: string;
    institution?: string;
    issuedAt?: Date;
    issuerEmail?: string;
    keyVersion?: number;
    revocationReason?: string;
  };
  errors: string[];
}

export class VerificationService {
  static async verifyDocument(documentId: string, fileBuffer: Buffer): Promise<VerificationResult> {
    const errors: string[] = [];
    const checks = {
      cryptographic: false,
      authority: false,
      revocation: false
    };

    try {
      const document = await prisma.document.findUnique({
        where: { id: documentId },
        include: {
          institution: true,
          user: true
        }
      });

      if (!document) {
        errors.push('Document not found');
        return { valid: false, checks, details: {}, errors };
      }

      const metadata = document.metadata as any;

      const keyVersion = metadata.keyVersion || 1;
      let publicKey = document.institution.rootPublicKey;

      if (keyVersion !== document.institution.keyVersion) {
        const history = document.institution.keyRotationHistory as any[];
        const historicalKey = history.find(k => k.version === keyVersion);
        if (historicalKey) {
          publicKey = historicalKey.publicKey;
        } else {
          errors.push(`Key version ${keyVersion} not found in institution history`);
        }
      }

      const cryptoValid = KeyManagementService.verifyDocument(
        fileBuffer,
        metadata.signature,
        publicKey
      );

      checks.cryptographic = cryptoValid;
      if (!cryptoValid) {
        errors.push('Cryptographic signature invalid - document may be tampered');
      }

      const issuerEmail = metadata.issuerEmail;
      const issuedAt = document.issuedAt;

      if (issuerEmail) {
        const issuer = await prisma.user.findUnique({
          where: { email: issuerEmail }
        });

        if (!issuer) {
          errors.push('Issuer no longer exists in system');
        } else if (issuer.institutionId !== document.institutionId) {
          errors.push('Issuer does not belong to issuing institution');
        } else if (issuer.whitelistedAt > issuedAt) {
          errors.push('Issuer was not authorized at time of issuance');
        } else if (issuer.revokedAt && issuer.revokedAt < issuedAt) {
          errors.push('Issuer authorization was revoked before issuance');
        } else {
          checks.authority = true;
        }
      } else {
        checks.authority = true;
      }

      const revocation = await prisma.revocation.findUnique({
        where: { documentId: document.id }
      });

      if (revocation) {
        errors.push(`Document revoked: ${revocation.reason || 'No reason provided'}`);
        checks.revocation = false;
      } else if (document.status === 'REVOKED') {
        errors.push('Document marked as revoked');
        checks.revocation = false;
      } else if (document.status === 'SUPERSEDED') {
        errors.push('Document has been superseded by a newer version');
        checks.revocation = false;
      } else {
        checks.revocation = true;
      }

      const valid = checks.cryptographic && checks.authority && checks.revocation;

      return {
        valid,
        checks,
        details: {
          documentType: document.type,
          institution: document.institution.name,
          issuedAt: document.issuedAt,
          issuerEmail,
          keyVersion,
          revocationReason: revocation?.reason || undefined
        },
        errors
      };

    } catch (error: any) {
      errors.push(`Verification error: ${error.message}`);
      return { valid: false, checks, details: {}, errors };
    }
  }
}
