const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE "chat_logs" DROP CONSTRAINT "chat_logs_sessionId_fkey"');
    console.log("FK dropped successfully.");
  } catch (err) {
    console.error("Error dropping FK:", err);
  } finally {
    await prisma.$disconnect();
  }
}
run();
