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
    const cipher = crypto.createCipheriv(this.ALGORITHM as any, key, iv);
    
    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = (cipher as any).getAuthTag();
    
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  static decryptPrivateKey(encryptedKey: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedKey.split(':');
    
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = crypto.scryptSync(this.MASTER_KEY, 'salt', 32);
    
    const decipher = crypto.createDecipheriv(this.ALGORITHM as any, key, iv);
    (decipher as any).setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  static signDocument(fileBuffer: Buffer, encryptedPrivateKey: string, keyVersion: number): { signature: string; hash: string } {
    const privateKey = this.decryptPrivateKey(encryptedPrivateKey);
    
    const hash = crypto.createHash('sha256').update(fileBuffer).digest();
    
    const signature = crypto.sign(null, hash, {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
    });
    
    return {
      signature: signature.toString('base64'),
      hash: hash.toString('hex')
    };
  }

  static verifyDocument(fileBuffer: Buffer, signatureBase64: string, publicKey: string): boolean {
    try {
      const hash = crypto.createHash('sha256').update(fileBuffer).digest();
      const signature = Buffer.from(signatureBase64, 'base64');
      
      return crypto.verify(
        null,
        hash,
        {
          key: publicKey,
          padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
          saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
        },
        signature
      );
    } catch (error) {
      return false;
    }
  }
}
