import { PrismaClient, InstitutionStatus } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('\n🏛️  Creating Alpha 1 Institution...\n');

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const alpha1 = await prisma.institution.create({
    data: {
      name: 'Alpha 1',
      emailDomain: 'alpha1.edu',
      publicKey: publicKey,
      privateKey: privateKey,
      status: InstitutionStatus.ACTIVE,
    },
  });

  console.log(`✅ Institution Created: ${alpha1.name}`);
  console.log(`📧 Email Domain: ${alpha1.emailDomain}`);
  console.log(`🆔 Institution ID: ${alpha1.id}\n`);

  const dummyUni = await prisma.institution.findFirst({
    where: { name: 'Dummy University' }
  });

  console.log('📋 All Institutions:');
  console.log(`   1. ${dummyUni?.name} (ID: ${dummyUni?.id})`);
  console.log(`   2. ${alpha1.name} (ID: ${alpha1.id})\n`);

  console.log('✅ Alpha 1 created successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
