const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkAdmin() {
  try {
    const user = await prisma.user.findUnique({
      where: { username: 'admin' },
      select: {
        id: true,
        username: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        role: true
      }
    });

    console.log('Admin User Status:', JSON.stringify(user, null, 2));
  } catch (err) {
    console.error('Error connecting to DB:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkAdmin();
