import { PrismaClient } from '@prisma/client';
import { KeyManagementService } from '../src/services/key-management.service.js';

const prisma = new PrismaClient();

async function main() {
  console.log('\n🔧 Regenerating institution keys with current master key...\n');

  const institutions = await prisma.institution.findMany();

  for (const inst of institutions) {
    console.log(`Processing: ${inst.name}`);

    // Generate fresh key pair
    const { publicKey, privateKey } = KeyManagementService.generateRootKeyPair();
    
    // Encrypt with CURRENT master key from .env
    const encryptedPrivateKey = KeyManagementService.encryptPrivateKey(privateKey);

    // Update institution
    await prisma.institution.update({
      where: { id: inst.id },
      data: {
        rootPublicKey: publicKey,
        rootPrivateKey: encryptedPrivateKey,
        keyVersion: 1,
        keyRotationHistory: JSON.stringify([{
          version: 1,
          publicKey: publicKey,
          privateKey: encryptedPrivateKey,
          createdAt: new Date(),
          revokedAt: null
        }])
      }
    });

    // Test decryption works
    try {
      const decrypted = KeyManagementService.decryptPrivateKey(encryptedPrivateKey);
      console.log(`  ✅ Keys generated and verified for ${inst.name}`);
    } catch (err) {
      console.log(`  ❌ Decryption test failed for ${inst.name}`);
    }
  }

  console.log('\n✅ All institution keys regenerated!\n');
  console.log('⚠️  NOTE: Existing documents will now fail verification because they were signed with old keys.');
  console.log('   You may need to re-upload documents.\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
