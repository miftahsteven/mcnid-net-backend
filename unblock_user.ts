import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const userId = "ORTniPGSeegGotEJTokRjmGGJfr1";
  const result = await prisma.blockedKiAiUser.deleteMany({
    where: { userId }
  });
  console.log(`Unblocked ${result.count} user(s) with ID: ${userId}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
