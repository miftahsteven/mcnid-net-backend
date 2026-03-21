import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../lib/prisma";

export async function latestPostsRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const now = new Date();

      // Fetch up to 12 latest posts published on or before now (enough buffer to filter out duplicates)
      const posts = await prisma.post.findMany({
        where: { status: "PUBLISHED", publishedAt: { lte: now } },
        orderBy: { publishedAt: "desc" },
        take: 12,
        include: { 
          categories: { include: { category: true } },
          author: { select: { name: true } }
        },
      });

      // Format
      const formattedPosts = posts.map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        image: p.coverImage,
        category: p.categories[0]?.category.name || "Berita",
        excerpt: p.excerpt || "",
        author: p.author?.name || "Administrator",
        publishedAt: p.publishedAt,
        type: "post",
        views: p.viewCount || 0,
        readingTime: Math.max(1, Math.ceil((p.content?.split(" ").length || 0) / 200))
      }));

      return reply.send({ data: formattedPosts });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Gagal mengambil data berita terbaru", message: error.message });
    }
  });
}
