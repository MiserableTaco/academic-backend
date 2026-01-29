import { PrismaClient } from '@prisma/client';
import { KeyManagementService } from '../src/services/key-management.service.js';

const prisma = new PrismaClient();

async function main() {
  console.log('\n🔐 Migrating existing institutions to root key model...\n');

  const institutions = await prisma.institution.findMany();

  for (const institution of institutions) {
    console.log(`Processing: ${institution.name}`);

    // Check if already has encrypted key
    if (institution.rootPrivateKey.includes(':')) {
      console.log('  ✅ Already migrated (key is encrypted)\n');
      continue;
    }

    // Encrypt existing private key
    const encryptedPrivateKey = KeyManagementService.encryptPrivateKey(institution.rootPrivateKey);

    // Update institution
    await prisma.institution.update({
      where: { id: institution.id },
      data: {
        rootPrivateKey: encryptedPrivateKey,
        rootPublicKey: institution.publicKey,
        keyVersion: 1,
        keyRotationHistory: JSON.stringify([
          {
            version: 1,
            publicKey: institution.publicKey,
            privateKey: encryptedPrivateKey,
            createdAt: institution.createdAt,
            revokedAt: null
          }
        ])
      }
    });

    console.log('  ✅ Migrated and encrypted root key\n');
  }

  // Update all existing documents with metadata
  const documents = await prisma.document.findMany({
    include: { user: true }
  });

  for (const doc of documents) {
    const metadata = doc.metadata as any;

    if (!metadata.keyVersion) {
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          metadata: {
            ...metadata,
            keyVersion: 1,
            issuerId: doc.userId, // Legacy: document owner was likely the issuer
            issuerEmail: doc.user.email,
            issuedAt: doc.issuedAt.toISOString()
          }
        }
      });
    }
  }

  console.log('✅ Migration complete!\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
