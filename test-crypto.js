import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function test() {
  const institution = await prisma.institution.findFirst();
  
  console.log('\n🔍 Testing Cryptography...\n');
  console.log('Private Key Length:', institution.privateKey.length, 'chars');
  console.log('Public Key Length:', institution.publicKey.length, 'chars');
  
  const testData = Buffer.from('This is a test document');
  const hash = crypto.createHash('sha256').update(testData).digest('hex');
  
  console.log('\n📄 Test Data Hash:', hash.substring(0, 16) + '...');
  
  try {
    const signature = crypto.sign('sha256', Buffer.from(hash, 'hex'), {
      key: institution.privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
    });
    
    console.log('✅ Signing Works! Signature length:', signature.length, 'bytes');
    
    const isValid = crypto.verify(
      'sha256',
      Buffer.from(hash, 'hex'),
      {
        key: institution.publicKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
      },
      signature
    );
    
    console.log('✅ Verification Works! Result:', isValid);
    
    if (isValid) {
      console.log('\n🎉 CRYPTOGRAPHY WORKING PERFECTLY!\n');
    } else {
      console.log('\n❌ VERIFICATION FAILED!\n');
    }
    
  } catch (error) {
    console.error('\n❌ CRYPTO ERROR:', error.message, '\n');
  }
  
  await prisma.$disconnect();
}

test();
