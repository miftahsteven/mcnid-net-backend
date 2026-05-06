import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../lib/prisma";

export async function indeksRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request: FastifyRequest<{
    Querystring: {
      page?: string;
      limit?: string;
      kategori?: string;
      tanggal?: string;
      q?: string;
    };
  }>, reply: FastifyReply) => {
    try {
      const { page = "1", limit = "20", kategori, tanggal, q } = request.query;
      console.log("[Indeks DEBUG] Query Params:", { page, limit, kategori, tanggal, q });

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const take = parseInt(limit);
      const fetchCount = skip + take;

      // slugify helper
      const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');

      const baseWhere: any = {
        status: "PUBLISHED",
        publishedAt: { lte: new Date() },
      };

      // Filter by Date if provided (YYYY-MM-DD)
      if (tanggal) {
        const startOfDay = new Date(tanggal);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(tanggal);
        endOfDay.setHours(23, 59, 59, 999);

        baseWhere.publishedAt = {
          gte: startOfDay,
          lte: endOfDay,
        };
      }

      // Base filters for Post and Video
      let postWhere = { ...baseWhere };
      let videoWhere = { ...baseWhere };

      // Search query - Type specific fields
      if (q) {
        postWhere.OR = [
          { title: { contains: q, mode: "insensitive" } },
          { excerpt: { contains: q, mode: "insensitive" } },
        ];
        videoWhere.OR = [
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ];
      }

      // Category Logic
      if (kategori) {
        const targetSlug = slugify(kategori);
        if (targetSlug === 'mcn-play') {
          // If MCN Play is selected, we only want Videos
          postWhere = { id: 'none' };
        } else {
          // Standard Category Filter
          const catFilter = {
            some: {
              category: {
                slug: targetSlug,
              },
            },
          };

          // Check if it matches one of the new subContent options
          const subContentOptions = ["Nasional", "Keislaman", "Tokoh", "Internasional", "Ekonomi", "Pendidikan", "Sosial", "Hukum"];
          const matchedOption = subContentOptions.find(opt => slugify(opt) === targetSlug);

          if (matchedOption) {
            // Match subContent OR categories
            postWhere.OR = [
              { subContent: matchedOption },
              { categories: catFilter }
            ];
          } else {
            postWhere.categories = catFilter;
          }

          videoWhere.categories = catFilter;
        }
      }

      console.log("[Indeks DEBUG] postWhere:", JSON.stringify(postWhere, null, 2));
      console.log("[Indeks DEBUG] videoWhere:", JSON.stringify(videoWhere, null, 2));

      // Fetch from both tables
      const [posts, videos, totalPosts, totalVideos] = await Promise.all([
        prisma.post.findMany({
          where: postWhere,
          orderBy: { publishedAt: "desc" },
          take: fetchCount,
          include: { categories: { include: { category: true } } },
        }),
        prisma.video.findMany({
          where: videoWhere,
          orderBy: { publishedAt: "desc" },
          take: fetchCount,
          include: { categories: { include: { category: true } } },
        }),
        prisma.post.count({ where: postWhere }),
        prisma.video.count({ where: videoWhere }),
      ]);

      console.log("[Indeks DEBUG] Raw Counts:", { posts: posts.length, videos: videos.length, totalPosts, totalVideos });

      // Merge and Format
      const formattedPosts = posts.map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        image: p.coverImage,
        category: p.subContent || p.categories[0]?.category.name || "Berita",
        categorySlug: p.subContent ? slugify(p.subContent) : (p.categories[0]?.category.slug || "berita"),
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
        categorySlug: v.categories[0]?.category.slug || "mcn-play",
        publishedAt: v.publishedAt,
        type: "video",
        views: v.viewCount || 0,
      }));

      const allItems = [...formattedPosts, ...formattedVideos].sort((a, b) => {
        const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return dateB - dateA;
      });

      // Manual pagination for merged results
      const paginatedItems = allItems.slice(skip, skip + take);
      const totalCount = totalPosts + totalVideos;

      return reply.send({
        data: paginatedItems,
        pagination: {
          total: totalCount,
          page: parseInt(page),
          limit: take,
          totalPages: Math.ceil(totalCount / take),
        },
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Gagal mengambil data indeks", message: error.message });
    }
  });
}
