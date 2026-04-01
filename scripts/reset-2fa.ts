import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetAll2FA() {
  console.log('--- RESETTING 2FA FOR ALL USERS ---');
  
  try {
    const result = await prisma.user.updateMany({
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null
      }
    });

    console.log(`Successfully reset 2FA for ${result.count} users.`);
    
    // Verify one user (admin)
    const admin = await prisma.user.findUnique({
      where: { username: 'admin' },
      select: { username: true, twoFactorEnabled: true }
    });
    console.log('Verification (admin):', admin);
    
  } catch (err: any) {
    console.error('Error during reset:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

resetAll2FA();
