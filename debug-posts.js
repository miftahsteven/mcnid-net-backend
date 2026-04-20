const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const counts = await prisma.post.groupBy({
    by: ['type'],
    _count: {
      id: true,
    },
  });
  console.log('Post counts by type:', JSON.stringify(counts, null, 2));

  const sample = await prisma.post.findFirst({
    where: { type: { contains: 'opinion', mode: 'insensitive' } },
    select: { id: true, title: true, type: true, status: true, publishedAt: true }
  });
  console.log('Sample opinion post:', JSON.stringify(sample, null, 2));

  const now = new Date();
  console.log('Current server time:', now.toISOString());
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
