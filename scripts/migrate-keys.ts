import { PrismaClient } from '@prisma/client';
import { KeyManagementService } from '../src/services/key-management.service.js';

const prisma = new PrismaClient();

async function main() {
  console.log('\n🔐 Migrating keys...\n');

  const institutions = await prisma.institution.findMany();

  for (const inst of institutions) {
    console.log(`Processing: ${inst.name}`);

    if (!inst.publicKey || !inst.privateKey) {
      console.log('  ⚠️  No existing keys found\n');
      continue;
    }

    // Encrypt the existing private key
    const encrypted = KeyManagementService.encryptPrivateKey(inst.privateKey);

    // Copy to new columns
    await prisma.institution.update({
      where: { id: inst.id },
      data: {
        rootPublicKey: inst.publicKey,
        rootPrivateKey: encrypted,
        keyRotationHistory: JSON.stringify([{
          version: 1,
          publicKey: inst.publicKey,
          privateKey: encrypted,
          createdAt: inst.createdAt,
          revokedAt: null
        }])
      }
    });

    console.log('  ✅ Migrated\n');
  }

  console.log('✅ Done!\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
