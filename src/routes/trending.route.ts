import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../lib/prisma";

export async function trendingRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Fetch top 5 most viewed posts
      const topPosts = await prisma.post.findMany({
        where: { status: "PUBLISHED" },
        orderBy: { viewCount: "desc" },
        take: 5,
        select: {
          id: true,
          title: true,
          slug: true,
          viewCount: true,
        }
      });

      // Fetch top 5 most viewed videos
      const topVideos = await prisma.video.findMany({
        where: { status: "PUBLISHED" },
        orderBy: { viewCount: "desc" },
        take: 5,
        select: {
          id: true,
          title: true,
          slug: true,
          viewCount: true,
        }
      });

      // Merge and sort again for absolute top 5
      const merged = [
        ...topPosts.map(p => ({ ...p, type: 'post', views: p.viewCount || 0 })),
        ...topVideos.map(v => ({ ...v, type: 'video', views: v.viewCount || 0 }))
      ]
      .sort((a, b) => (b.views as number) - (a.views as number))
      .slice(0, 5);

      return reply.send({ data: merged });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Gagal mengambil data trending" });
    }
  });
}
