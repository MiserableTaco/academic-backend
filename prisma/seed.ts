import { PrismaClient, UserRole, InstitutionStatus } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('\n========================================');
  console.log('🌱 Seeding database...');
  console.log('========================================\n');

  await prisma.accessLog.deleteMany();
  await prisma.oTPVerification.deleteMany();
  await prisma.device.deleteMany();
  await prisma.document.deleteMany();
  await prisma.user.deleteMany();
  await prisma.institution.deleteMany();

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });

  const institution = await prisma.institution.create({
    data: {
      name: 'Dummy University',
      emailDomain: 'dummy.edu',
      publicKey: publicKey,
      privateKey: privateKey,
      status: InstitutionStatus.ACTIVE,
    },
  });

  console.log(`✅ Institution: ${institution.name}`);
  console.log(`📧 Email Domain: ${institution.emailDomain}\n`);
  console.log('🔐 RSA-4096 Keys Generated & Stored\n');

  await prisma.user.create({
    data: {
      email: 'gerard.qiu803@gmail.com',
      institutionId: institution.id,
      role: UserRole.ADMIN,
      verified: true,
    },
  });

  console.log('✅ Created user: gerard.qiu803@gmail.com (ADMIN)');
  console.log('\n========================================');
  console.log('🎉 Seeding completed!');
  console.log('========================================\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
