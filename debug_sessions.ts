import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const final_user_id = "ORTniPGSeegGotEJTokRjmGGJfr1";
  
  const logs = await prisma.chatLog.findMany({
    where: { userId: final_user_id },
    orderBy: { createdAt: 'desc' },
    distinct: ['sessionId'],
    select: {
      sessionId: true,
      question: true,
      createdAt: true
    },
    take: 10
  });
  
  const isBlocked = await prisma.blockedKiAiUser.findUnique({
    where: { userId: final_user_id }
  });

  console.log('--- DEBUG SESSIONS ---');
  console.log('User ID:', final_user_id);
  console.log('Logs Count:', logs.length);
  console.log('Logs:', JSON.stringify(logs, null, 2));
  console.log('Is Blocked:', !!isBlocked);
}

main().catch(console.error).finally(() => prisma.$disconnect());
