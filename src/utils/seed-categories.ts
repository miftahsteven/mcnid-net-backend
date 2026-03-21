import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import path from 'path';

// Load env from backend root
dotenv.config({ path: path.join(__dirname, '../../.env') });

const prisma = new PrismaClient();

async function main() {
  console.log('--- Seeding Categories ---');

  const categories = [
    { name: 'Berita', slug: 'berita' },
    { name: 'Opini', slug: 'opini' },
  ];

  const createdCategories = [];

  for (const cat of categories) {
    const upserted = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: cat,
    });
    console.log(`Category: ${upserted.name} (ID: ${upserted.id})`);
    createdCategories.push(upserted);
  }

  const beritaCat = createdCategories.find(c => c.slug === 'berita');

  if (!beritaCat) {
    console.error('Failed to find Berita category');
    return;
  }

  console.log('\n--- Connecting Posts to Berita (Default) ---');
  
  // Find posts without categories
  const postsWithoutCat = await prisma.post.findMany({
    where: {
      categories: {
        none: {}
      }
    }
  });

  console.log(`Found ${postsWithoutCat.length} posts without categories.`);

  for (const post of postsWithoutCat) {
    await prisma.postCategory.create({
      data: {
        postId: post.id,
        categoryId: beritaCat.id,
      },
    });
    console.log(`Linked: ${post.title}`);
  }

  console.log('\n--- Seeding Complete ---');
}

main()
  .catch((e) => {
    console.error('Error seeding categories:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
