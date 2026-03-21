import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../lib/prisma";

export async function latestRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const now = new Date();

      // Fetch up to 4 latest posts published on or before now
      const posts = await prisma.post.findMany({
        where: { status: "PUBLISHED", publishedAt: { lte: now } },
        orderBy: { publishedAt: "desc" },
        take: 4,
        include: { categories: { include: { category: true } } },
      });

      // Fetch up to 4 latest videos published on or before now
      const videos = await prisma.video.findMany({
        where: { status: "PUBLISHED", publishedAt: { lte: now } },
        orderBy: { publishedAt: "desc" },
        take: 4,
        include: { categories: { include: { category: true } } },
      });

      // Format
      const formattedPosts = posts.map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        image: p.coverImage,
        category: p.categories[0]?.category.name || "Berita",
        publishedAt: p.publishedAt,
        type: "post",
        views: p.viewCount || 0,
      }));

      const formattedVideos = videos.map((v) => ({
        id: v.id,
        title: v.title,
        slug: v.slug,
        image: v.coverImage,
        category: v.categories[0]?.category.name || "MCN Play",
        publishedAt: v.publishedAt,
        type: "video",
        views: v.viewCount || 0,
      }));

      let mixed = [...formattedPosts, ...formattedVideos];
      
      // Sort newest absolute first
      mixed.sort((a: any, b: any) => {
        const dA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const dB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return dB - dA;
      });
      mixed = mixed.slice(0, 4);

      return reply.send({ data: mixed });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Gagal mengambil data terbaru", message: error.message });
    }
  });
}
