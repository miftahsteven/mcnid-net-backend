
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const posts = await prisma.post.findMany({
    take: 10,
    select: {
      id: true,
      title: true,
      subContent: true,
    }
  });
  console.log('Posts:', JSON.stringify(posts, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
