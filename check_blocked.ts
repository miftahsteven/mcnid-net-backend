import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const blocked = await prisma.blockedKiAiUser.findMany();
  console.log('--- BLOCKED USERS ---');
  console.log(JSON.stringify(blocked, null, 2));
  
  const logs = await prisma.chatLog.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' }
  });
  console.log('--- LATEST LOGS ---');
  console.log(JSON.stringify(logs, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
