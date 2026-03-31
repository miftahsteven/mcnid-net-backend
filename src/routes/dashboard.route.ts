import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { prisma } from '../lib/prisma';
import { authMiddleware, requireRole } from '../middlewares/auth.middleware';

const analyticsDataClient = new BetaAnalyticsDataClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
});

export async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.get('/stats', {
    preHandler: [authMiddleware, requireRole('SUPER_ADMIN', 'ADMIN', 'EDITOR')],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const totalNews = await prisma.post.count();
        const totalVideo = await prisma.video.count();
        const totalAcademy = await prisma.enrollment.count();

        // Trending News (Views > 20)
        const trendingNews = await prisma.post.count({
          where: { viewCount: { gt: 20 } }
        });

        // Total Keseluruhan Views (Post + Video)
        const postViews = await prisma.post.aggregate({
          _sum: { viewCount: true }
        });
        const videoViews = await prisma.video.aggregate({
          _sum: { viewCount: true }
        });
        const totalViews = (postViews._sum.viewCount || 0) + (videoViews._sum.viewCount || 0);

        // Integrasi API Realtime Google Analytics
        let onlineRealtime = 0;
        const propertyId = process.env.GA_PROPERTY_ID;

        try {
          if (propertyId) {
            const [response] = await analyticsDataClient.runRealtimeReport({
              property: `properties/${propertyId}`,
              metrics: [{ name: 'activeUsers' }],
            });
            if (response && response.rows && response.rows.length > 0) {
              const activeUsersStr = response.rows[0].metricValues?.[0]?.value || '0';
              onlineRealtime = parseInt(activeUsersStr, 10);
            }
          }
        } catch (gaError: any) {
          request.log.warn(`⚠️ Google Analytics Realtime API Error: ${gaError.message}`);
          onlineRealtime = 0; // Tampilkan 0 jika error, hindari simulasi angka acak yang membingungkan.
        }

        return reply.send({
          data: {
            totalNews,
            totalVideo,
            totalAcademy,
            trendingNews,
            totalViews,
            onlineRealtime
          }
        });
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({ error: 'Internal server error calculating stats' });
      }
    }
  });

  fastify.get('/realtime-visitors', {
    preHandler: [authMiddleware, requireRole('SUPER_ADMIN', 'ADMIN', 'EDITOR')],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const propertyId = process.env.GA_PROPERTY_ID;
        if (!propertyId) {
          return reply.send({ onlineRealtime: 0, status: 'no_property_id' });
        }

        const [response] = await analyticsDataClient.runRealtimeReport({
          property: `properties/${propertyId}`,
          metrics: [{ name: 'activeUsers' }],
        });

        const activeUsersStr = response.rows?.[0]?.metricValues?.[0]?.value || '0';
        const onlineRealtime = parseInt(activeUsersStr, 10);

        return reply.send({ onlineRealtime });
      } catch (err: any) {
        request.log.error(`⚠️ GA Realtime Error: ${err.message}`);
        return reply.send({ onlineRealtime: 0, error: err.message });
      }
    }
  });

  fastify.get('/recent-content', {
    preHandler: [authMiddleware, requireRole('SUPER_ADMIN', 'ADMIN', 'EDITOR')],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const now = new Date();

        // 1. Fetch 10 Latest Posts (Status: PUBLISHED)
        const posts = await prisma.post.findMany({
          where: { status: 'PUBLISHED', publishedAt: { lte: now } },
          orderBy: { publishedAt: 'desc' },
          take: 10,
          include: { categories: { include: { category: true } } }
        });

        // 2. Fetch 5 Latest Videos (MCN Play)
        const videos = await prisma.video.findMany({
          where: { status: 'PUBLISHED', publishedAt: { lte: now } },
          orderBy: { publishedAt: 'desc' },
          take: 20,
          include: { categories: { include: { category: true } } }
        });

        // 3. Transform & Combine
        const formattedPosts = posts.map(p => ({
          id: p.id,
          title: p.title,
          image: p.coverImage || '/placeholder-news.jpg',
          category: p.categories[0]?.category.name || 'Berita',
          publishedAt: p.publishedAt,
          views: p.viewCount || 0,
          type: 'post'
        }));

        const formattedVideos = videos.map(v => ({
          id: v.id,
          title: v.title,
          image: v.coverImage || '/placeholder-video.jpg',
          category: v.categories[0]?.category.name || 'MCN Play',
          publishedAt: v.publishedAt,
          views: v.viewCount || 0,
          type: 'video'
        }));

        const combined = [...formattedPosts, ...formattedVideos].sort((a, b) => {
          const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
          const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
          return dateB - dateA;
        });

        return reply.send({
          data: combined.slice(0, 15)
        });
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({ error: 'Internal server error fetching recent content' });
      }
    }
  });

  fastify.get('/authors-report', {
    preHandler: [authMiddleware, requireRole('SUPER_ADMIN', 'ADMIN', 'EDITOR')],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const users = await prisma.user.findMany({
          select: {
            id: true,
            name: true,
            image: true,
            role: true,
            posts: { select: { viewCount: true } },
            videos: { select: { viewCount: true } }
          }
        });

        const report = users.map(user => {
          const totalPosts = user.posts.length;
          const totalVideos = user.videos.length;
          const postViews = user.posts.reduce((acc, p) => acc + (p.viewCount || 0), 0);
          const videoViews = user.videos.reduce((acc, v) => acc + (v.viewCount || 0), 0);

          return {
            id: user.id,
            name: user.name,
            image: user.image,
            totalContent: totalPosts + totalVideos,
            totalViews: postViews + videoViews,
            role: user.role
          };
        })
        .filter(u => u.totalContent > 0)
        .sort((a, b) => b.totalContent - a.totalContent);

        return reply.send({ data: report.slice(0, 10) }); // Top 10 authors
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({ error: 'Internal server error fetching authors report' });
      }
    }
  });
}
