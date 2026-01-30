import crypto from 'crypto';
import sodium from 'libsodium-wrappers';

await sodium.ready;

export class EncryptionService {
  static hashDocument(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  static generateDocumentKey(): Buffer {
    return crypto.randomBytes(32);
  }

  static encryptDocument(buffer: Buffer, key: Buffer): { encrypted: Buffer; iv: Buffer; authTag: Buffer } {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return { encrypted, iv, authTag };
  }

  static decryptDocument(encrypted: Buffer, key: Buffer, iv: Buffer, authTag: Buffer): Buffer {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  static signHash(hash: string, privateKey: Uint8Array): string {
    const hashBuffer = Buffer.from(hash, 'hex');
    const signature = sodium.crypto_sign_detached(hashBuffer, privateKey);
    return Buffer.from(signature).toString('base64');
  }

  static verifySignature(hash: string, signature: string, publicKey: Uint8Array): boolean {
    try {
      const hashBuffer = Buffer.from(hash, 'hex');
      const signatureBuffer = Buffer.from(signature, 'base64');
      return sodium.crypto_sign_verify_detached(signatureBuffer, hashBuffer, publicKey);
    } catch {
      return false;
    }
  }

  static generateKeyPair(): { publicKey: string; privateKey: string } {
    const keypair = sodium.crypto_sign_keypair();
    return {
      publicKey: Buffer.from(keypair.publicKey).toString('base64'),
      privateKey: Buffer.from(keypair.privateKey).toString('base64'),
    };
  }
}
