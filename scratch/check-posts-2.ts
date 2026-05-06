
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const posts = await prisma.post.findMany({
    take: 5,
    select: {
      id: true,
      title: true,
      subContent: true,
      status: true,
      publishedAt: true,
    }
  });
  console.log('Posts:', JSON.stringify(posts, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
