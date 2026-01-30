import crypto from 'crypto';

export class KeyManagementService {
  private static MASTER_KEY = process.env.MASTER_ENCRYPTION_KEY || 'default-master-key-change-in-production';
  private static ALGORITHM = 'aes-256-gcm';

  static generateRootKeyPair(): { publicKey: string; privateKey: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    return { publicKey, privateKey };
  }

  static encryptPrivateKey(privateKey: string): string {
    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(this.MASTER_KEY, 'salt', 32);
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);
    
    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    
    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  static decryptPrivateKey(encryptedKey: string): string {
    // Format: iv:authTag:encrypted (colon-separated)
    const [iv, authTag, encrypted] = encryptedKey.split(':');
    
    const key = crypto.scryptSync(this.MASTER_KEY, 'salt', 32);
    const decipher = crypto.createDecipheriv(this.ALGORITHM, key, Buffer.from(iv, 'hex'));
    
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  static hashDocument(fileBuffer: Buffer): string {
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  static signDocument(hash: string, encryptedPrivateKey: string, encryptionKey: string): string {
    const privateKey = this.decryptPrivateKey(encryptedPrivateKey);
    
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(hash);
    const signature = sign.sign(privateKey, 'base64');
    
    return signature;
  }

  static verifyDocument(fileBuffer: Buffer, signatureBase64: string, publicKey: string, expectedHash: string): boolean {
    const actualHash = this.hashDocument(fileBuffer);
    
    if (actualHash !== expectedHash) {
      return false;
    }
    
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(expectedHash);
    
    return verify.verify(publicKey, signatureBase64, 'base64');
  }
}
