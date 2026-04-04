import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.chatLog.findMany({
    where: { NOT: { userId: null } },
    take: 10,
    orderBy: { createdAt: 'desc' }
  });
  console.log('--- LOGS WITH USER ID ---');
  console.log(JSON.stringify(logs, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
