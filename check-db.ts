import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.chatLog.count();
  console.log('Total chat logs:', count);
  
  const latest = await prisma.chatLog.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    select: { sessionId: true, userId: true, question: true, createdAt: true }
  });
  console.log('Latest 5 logs:', JSON.stringify(latest, null, 2));

  const distinctUsers = await prisma.chatLog.findMany({
    distinct: ['userId'],
    select: { userId: true }
  });
  console.log('Distinct User IDs in DB:', distinctUsers.map(u => u.userId));
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
