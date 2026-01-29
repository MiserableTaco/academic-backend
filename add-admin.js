import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const institution = await prisma.institution.findFirst({
    where: { emailDomain: 'nus.edu.sg' }
  });

  if (!institution) {
    console.log('❌ No institution found');
    return;
  }

  const user = await prisma.user.upsert({
    where: { email: 'gerard.qiu803@gmail.com' },
    update: { role: 'ADMIN', verified: true },
    create: {
      email: 'gerard.qiu803@gmail.com',
      institutionId: institution.id,
      role: 'ADMIN',
      verified: true,
    },
  });

  console.log('✅ Admin user created:', user.email);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
