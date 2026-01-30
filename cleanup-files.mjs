import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';

const prisma = new PrismaClient();

async function cleanupOrphanedFiles() {
  console.log('🧹 Starting file cleanup...');

  const uploadsDir = path.join(process.cwd(), 'uploads');
  
  // Get all file paths from database
  const documents = await prisma.document.findMany({
    select: { metadata: true }
  });

  const dbFilePaths = new Set(
    documents.map(doc => doc.metadata.filePath).filter(Boolean)
  );

  console.log(`📊 Documents in database: ${documents.length}`);

  // Get all files in uploads directory
  const files = await fs.readdir(uploadsDir).catch(() => []);
  console.log(`📁 Files on disk: ${files.length}`);

  let orphanedCount = 0;

  for (const file of files) {
    const filePath = path.join(uploadsDir, file);
    
    if (!dbFilePaths.has(filePath)) {
      console.log(`🗑️  Deleting orphaned file: ${file}`);
      await fs.unlink(filePath);
      orphanedCount++;
    }
  }

  console.log(`\n✅ Cleanup complete!`);
  console.log(`   Orphaned files deleted: ${orphanedCount}`);
  console.log(`   Files remaining: ${files.length - orphanedCount}`);

  await prisma.$disconnect();
  process.exit(0);
}

cleanupOrphanedFiles().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
