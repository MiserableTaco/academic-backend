import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const alpha1 = await prisma.institution.findFirst({
    where: { name: 'Alpha 1' }
  });

  if (!alpha1) {
    console.error('❌ Alpha 1 not found. Run create-alpha1.ts first!');
    process.exit(1);
  }

  console.log(`\n📋 Adding students to: ${alpha1.name}\n`);

  const studentEmails = [
    'chengwei.qiu@gmail.com',
    'student2@alpha1.edu',
    'student3@alpha1.edu',
  ];

  let added = 0;
  let skipped = 0;

  for (const email of studentEmails) {
    try {
      const exists = await prisma.user.findUnique({ where: { email } });
      
      if (exists) {
        console.log(`⏭️  Skipped: ${email}`);
        skipped++;
        continue;
      }

      await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          institutionId: alpha1.id,
          role: UserRole.STUDENT,
          verified: false
        }
      });

      console.log(`✅ Added: ${email}`);
      added++;
    } catch (err) {
      console.error(`❌ Failed: ${email}`);
    }
  }

  console.log(`\n📊 Summary: Added ${added}, Skipped ${skipped}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
