import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { CreateVideoSchema, UpdateVideoSchema } from '../validators/video.schema';
import { authMiddleware, requireRole } from '../middlewares/auth.middleware';
import { sanitizeRichText } from '../middlewares/sanitize';
import { internalApiMiddleware } from '../middlewares/internal.middleware';
import { ZodError } from 'zod';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

export async function videosRoutes(fastify: FastifyInstance) {
  // PUBLIC: GET all videos (filtered & sorted)
  fastify.get('/', async (request: FastifyRequest<{ Querystring: { search?: string, categoryId?: string, sort?: string } }>, reply: FastifyReply) => {
    const { search, categoryId, sort } = request.query;
    
    const where: any = { status: 'PUBLISHED' };
    
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }
    
    if (categoryId && categoryId !== 'all') {
      where.categories = {
        some: { categoryId }
      };
    }
    
    let orderBy: any = { publishedAt: 'desc' };
    if (sort === 'viral') {
      orderBy = { viewCount: 'desc' };
    } else if (sort === 'latest') {
      orderBy = { publishedAt: 'desc' };
    }
    
    const videos = await prisma.video.findMany({
      where,
      select: {
        id: true, title: true, slug: true, description: true, 
        sourceType: true, videoUrl: true, coverImage: true, duration: true, isHighlight: true,
        status: true, publishedAt: true, viewCount: true, likeCount: true, dislikeCount: true,
        author: { select: { name: true } },
        categories: { select: { category: { select: { id: true, name: true, slug: true } } } },
      },
      orderBy,
    });
    return reply.send({ data: videos });
  });

  // PUBLIC: GET video categories (for sidebar)
  fastify.get('/categories/active', async (request: FastifyRequest, reply: FastifyReply) => {
    const categories = await prisma.category.findMany({
      where: { 
        videos: { 
          some: { 
            video: { status: 'PUBLISHED' } 
          } 
        } 
      },
      orderBy: { name: 'asc' },
    });
    return reply.send({ data: categories });
  });

  // PUBLIC: POST like video
  fastify.post('/:id/like', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const video = await prisma.video.update({
      where: { id: request.params.id },
      data: { likeCount: { increment: 1 } },
    });
    return reply.send({ data: { likeCount: video.likeCount } });
  });

  // PUBLIC: POST dislike video
  fastify.post('/:id/dislike', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const video = await prisma.video.update({
      where: { id: request.params.id },
      data: { dislikeCount: { increment: 1 } },
    });
    return reply.send({ data: { dislikeCount: video.dislikeCount } });
  });

  // INTERNAL: GET single published video by slug
  fastify.get('/:slug', {
    preHandler: [internalApiMiddleware],
    handler: async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const video = await prisma.video.findUnique({
        where: { slug: request.params.slug, status: 'PUBLISHED' },
        include: {
          author: { select: { name: true, image: true } },
          categories: { select: { category: true } },
        },
      });
      if (!video) return reply.status(404).send({ error: 'Video not found' });
      return reply.send({ data: video });
    }
  });

  // ADMIN: GET all videos (all statuses)
  fastify.get('/admin/all', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'EDITOR', 'SUPER_ADMIN')],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const videos = await prisma.video.findMany({
        select: {
          id: true, title: true, slug: true, description: true,
          sourceType: true, videoUrl: true, coverImage: true, duration: true, isHighlight: true,
          status: true, publishedAt: true, createdAt: true,
          author: { select: { name: true } },
          categories: { select: { category: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send({ data: videos });
    },
  });

  // ADMIN: GET single video by ID
  fastify.get('/admin/:id', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'EDITOR', 'SUPER_ADMIN')],
    handler: async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const video = await prisma.video.findUnique({
        where: { id: request.params.id },
        include: {
          categories: { select: { categoryId: true, category: { select: { name: true } } } },
        },
      });
      if (!video) return reply.status(404).send({ error: 'Video not found' });
      return reply.send({ data: video });
    },
  });

  // ADMIN: POST create video
  fastify.post('/', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'EDITOR', 'SUPER_ADMIN')],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = CreateVideoSchema.parse(request.body);
        const { categoryId, categoryIds, description, publishedAt, ...rest } = body;
        const cats = categoryIds || (categoryId ? [categoryId] : []);

        const video = await prisma.video.create({
          data: {
            ...rest,
            description: description ? sanitizeRichText(description) : undefined,
            authorId: (request as any).user.sub,
            publishedAt: publishedAt || (rest.status === 'PUBLISHED' ? new Date() : null),
            categories: cats.length > 0 ? {
              create: cats.map((id) => ({ categoryId: id })),
            } : undefined,
          },
        });
        return reply.status(201).send({ data: video });
      } catch (err) {
        if (err instanceof ZodError) return reply.status(400).send({ error: err.errors });
        throw err;
      }
    },
  });

  // ADMIN: PATCH update video
  fastify.patch('/:id', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'EDITOR', 'SUPER_ADMIN')],
    handler: async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const body = UpdateVideoSchema.parse(request.body);
        const { categoryId, categoryIds, description, publishedAt, ...rest } = body;
        const cats = categoryIds || (categoryId ? [categoryId] : undefined);
        const hasCatsUpdate = cats !== undefined;

        const video = await prisma.video.update({
          where: { id: request.params.id },
          data: {
            ...rest,
            ...(description && { description: sanitizeRichText(description) }),
            ...(publishedAt ? { publishedAt } : (rest.status === 'PUBLISHED' ? { publishedAt: new Date() } : {})),
            ...(hasCatsUpdate ? {
              categories: {
                deleteMany: {},
                create: cats.map((id) => ({ categoryId: id }))
              }
            } : {}),
          },
        });
        return reply.send({ data: video });
      } catch (err) {
        if (err instanceof ZodError) return reply.status(400).send({ error: err.errors });
        throw err;
      }
    },
  });

  // ADMIN: DELETE video
  fastify.delete('/:id', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'SUPER_ADMIN')],
    handler: async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      await prisma.video.delete({ where: { id: request.params.id } });
      return reply.send({ message: 'Video deleted' });
    },
  });

  // ADMIN: POST download youtube cover
  fastify.post('/youtube-cover', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'EDITOR', 'SUPER_ADMIN')],
    handler: async (request: FastifyRequest<{ Body: { url: string } }>, reply: FastifyReply) => {
      try {
        const { url } = request.body;
        if (!url) return reply.status(400).send({ error: 'URL required' });
        
        let ytId = '';
        const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
        if (match && match[1]) {
          ytId = match[1];
        } else {
          return reply.status(400).send({ error: 'Invalid YouTube URL' });
        }

        const coverUrl = `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`;
        const response = await axios.get(coverUrl, { responseType: 'arraybuffer' });
        
        // Save to public/uploads which is served statically
        const uploadDir = path.join(__dirname, '../../public/uploads');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }

        const filename = `yt-${ytId}-${randomBytes(4).toString('hex')}.png`;
        const filepath = path.join(uploadDir, filename);
        
        await fs.promises.writeFile(filepath, Buffer.from(response.data, 'binary'));
        
        const host = request.headers.host || process.env.BACKEND_URL?.replace(/^https?:\/\//, '') || 'localhost:4000';
        const fileUrl = `${request.protocol}://${host}/uploads/${filename}`;
        
        return reply.send({ url: fileUrl });
      } catch (err) {
        return reply.status(500).send({ error: 'Failed to download YouTube cover' });
      }
    },
  });
}
