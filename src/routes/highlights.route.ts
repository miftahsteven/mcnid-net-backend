import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../lib/prisma";

export async function highlightsRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Fetch up to 5 highlighted posts (either by isHighlight flag or type="HIGHLIGHT")
      const posts = await prisma.post.findMany({
        where: { 
          OR: [
            { isHighlight: true },
            { type: "HIGHLIGHT" }
          ],
          status: "PUBLISHED" 
        },
        orderBy: { publishedAt: "desc" },
        take: 5,
        include: {
          author: { select: { name: true } },
          categories: { include: { category: true } },
        },
      });

      // Fetch up to 5 highlighted videos
      const videos = await prisma.video.findMany({
        where: { isHighlight: true, status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        take: 5,
        include: {
          author: { select: { name: true } },
          categories: { include: { category: true } },
        },
      });

      // Format and merge
      const formattedPosts = posts.map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        image: p.coverImage,
        category: p.categories[0]?.category.name || "Berita",
        excerpt: p.excerpt || "",
        author: p.author.name,
        publishedAt: p.publishedAt,
        type: "post",
        views: p.viewCount || 0,
      }));

      const formattedVideos = videos.map((v) => ({
        id: v.id,
        title: v.title,
        slug: v.slug, // Can be used for /mcn-play forwarding 
        image: v.coverImage,
        category: v.categories[0]?.category.name || "MCN Play",
        excerpt: v.description?.substring(0, 150) || "",
        author: v.author.name,
        publishedAt: v.publishedAt,
        type: "video",
        views: v.viewCount || 0,
      }));

      let mixed = [...formattedPosts, ...formattedVideos];
      
      // Sort by absolute newest first and slice top 5
      mixed.sort((a: any, b: any) => {
        const dA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const dB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return dB - dA;
      });
      mixed = mixed.slice(0, 5);

      // Fallback: If absolutely 0 highlights, fetch 1 latest Post
      if (mixed.length === 0) {
        const latestFallback = await prisma.post.findFirst({
          where: { status: "PUBLISHED" },
          orderBy: { publishedAt: "desc" },
          include: {
            author: { select: { name: true } },
            categories: { include: { category: true } },
          },
        });
        
        if (latestFallback) {
          mixed.push({
            id: latestFallback.id,
            title: latestFallback.title,
            slug: latestFallback.slug,
            image: latestFallback.coverImage,
            category: latestFallback.categories[0]?.category.name || "Berita",
            excerpt: latestFallback.excerpt || "",
            author: latestFallback.author.name,
            publishedAt: latestFallback.publishedAt,
            type: "post",
            views: latestFallback.viewCount || 0,
          });
        }
      }

      return reply.send({ data: mixed });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Gagal mengambil data highlights", message: error.message });
    }
  });
}
