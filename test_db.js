const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    const session_id = "test_sess_" + Date.now();
    let session = await prisma.chatSession.create({
      data: {
        id: session_id,
        userId: "test_user_id",
        channel: 'web',
        activeAgent: 'general'
      }
    });
    console.log("Created session:", session);
    
    const log = await prisma.chatLog.create({
      data: {
        sessionId: session.id,
        question: "test",
        answer: "test",
        channel: "web",
        agent: "general"
      }
    });
    console.log("Created log:", log);
  } catch (err) {
    console.error("DB Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}
test();
