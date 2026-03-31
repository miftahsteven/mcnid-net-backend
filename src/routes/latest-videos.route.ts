import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../lib/prisma";

export async function latestVideosRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const now = new Date();

      // Fetch 5 latest videos published on or before now
      const videos = await prisma.video.findMany({
        where: { status: "PUBLISHED", publishedAt: { lte: now } },
        orderBy: { publishedAt: "desc" },
        take: 50,
        include: { 
          categories: { include: { category: true } },
          author: { select: { name: true } }
        },
      });

      const getYoutubeId = (url: string) => {
        if (!url) return null;
        const match = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/);
        return match ? match[1] : null;
      };

      // Format the videos
      const formattedVideos = videos.map((v) => {
        const yId = getYoutubeId(v.videoUrl || "");
        return {
          id: v.id,
          title: v.title,
          slug: v.slug,
          youtubeId: yId,
          videoUrl: v.videoUrl,
          thumbnail: v.coverImage || (yId ? `https://i.ytimg.com/vi/${yId}/hqdefault.jpg` : "/placeholder-video.jpg"),
          category: v.categories[0]?.category.name || "MCN Play",
          duration: v.duration || "00:00",
          author: v.author?.name || "Administrator",
          publishedAt: v.publishedAt,
          views: v.viewCount || 0,
        };
      });

      return reply.send({ data: formattedVideos });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Gagal mengambil data video terbaru", message: error.message });
    }
  });
}
