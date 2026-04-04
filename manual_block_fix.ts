import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const userId = "ORTniPGSeegGotEJTokRjmGGJfr1";
  const userName = "SupplyData Supply Data";
  const userEmail = "miftahsyarief@gmail.com"; // placeholder or from user context

  const blocked = await prisma.blockedKiAiUser.upsert({
    where: { userId },
    update: { 
      userName, 
      userEmail, 
      reason: "Manual re-block for testing persistence and visibility." 
    },
    create: { 
      userId, 
      userName, 
      userEmail, 
      reason: "Manual re-block for testing persistence and visibility." 
    }
  });

  console.log('Successfully blocked user manually:', blocked);
}

main().catch(console.error).finally(() => prisma.$disconnect());
