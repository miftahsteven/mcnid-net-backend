import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware, requireRole } from '../middlewares/auth.middleware';
import { prisma } from '../lib/prisma';
import { CreatePostSchema, UpdatePostSchema } from '../utils/zod-schemas';
import { sanitizeRichText, sanitizePlainText } from '../middlewares/sanitize';
import { internalApiMiddleware } from '../middlewares/internal.middleware';
import { ZodError } from 'zod';

export async function postsRoutes(fastify: FastifyInstance) {
  // GET all published posts (public)
  fastify.get('/', async (request: FastifyRequest<{ Querystring: { type?: string; limit?: string } }>, reply: FastifyReply) => {
    const { type, limit } = request.query as { type?: string; limit?: string };
    const take = limit ? parseInt(limit) : undefined;

    const posts = await prisma.post.findMany({
      where: {
        status: 'PUBLISHED',
        publishedAt: { lte: new Date() },
        ...(type ? { 
          type: {
            equals: type,
            mode: 'insensitive'
          }
        } : {}),
      },
      select: {
        id: true, title: true, slug: true, excerpt: true,
        content: true,
        type: true,
        coverImage: true, publishedAt: true, viewCount: true,
        customAuthor: true,
        author: { select: { name: true, image: true } },
        categories: { select: { category: { select: { name: true, slug: true } } } },
      },
      orderBy: { publishedAt: 'desc' },
      ...(take ? { take } : {}),
    });

    // Fallback excerpt generation if empty
    const postsWithExcerpt = posts.map(post => ({
      ...post,
      excerpt: post.excerpt || post.content?.replace(/<[^>]*>?/gm, '').substring(0, 160) + '...',
      content: undefined // Remove content from list response to keep it light
    }));

    return reply.send({ data: postsWithExcerpt });
  });

  // GET all posts for admin (all statuses)
  fastify.get('/admin/all', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'EDITOR', 'SUPER_ADMIN')],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const posts = await prisma.post.findMany({
        select: {
          id: true, title: true, slug: true, excerpt: true, type: true,
          status: true, coverImage: true, publishedAt: true, createdAt: true,
          author: { select: { name: true } },
          categories: { select: { category: { select: { name: true } } } },
          tags: { select: { tag: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send({ data: posts });
    },
  });

  // GET single post by ID for admin editor
  fastify.get('/admin/:id', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'EDITOR', 'SUPER_ADMIN')],
    handler: async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const post = await prisma.post.findUnique({
        where: { id: request.params.id },
        include: {
          categories: true,
          tags: { include: { tag: true } }
        }
      });
      if (!post) return reply.status(404).send({ error: 'Post not found' });
      return reply.send({ data: post });
    }
  });

  // GET single post by slug using QUERY PARAM — bypasses maxParamLength restriction
  fastify.get('/by-slug', {
    preHandler: [internalApiMiddleware],
    handler: async (request: FastifyRequest<{ Querystring: { slug: string } }>, reply: FastifyReply) => {
      const slug = (request.query as any).slug;
      if (!slug) return reply.status(400).send({ error: 'Missing slug query parameter' });
      const post = await prisma.post.findUnique({
        where: { slug },
        include: {
          author: { select: { name: true, image: true } },
          categories: { select: { category: true } },
          tags: { select: { tag: true } },
        },
      });
      if (!post) return reply.status(404).send({ error: 'Post not found' });
      return reply.send({ data: post });
    }
  });

  // GET single post by slug (internal / Next.js SSR)
  fastify.get('/:slug', {
    preHandler: [internalApiMiddleware],
    handler: async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const post = await prisma.post.findUnique({
        where: { slug: request.params.slug },
        include: {
          author: { select: { name: true, image: true } },
          categories: { select: { category: true } },
          tags: { select: { tag: true } },
        },
      });
      if (!post) return reply.status(404).send({ error: 'Post not found' });
      return reply.send({ data: post });
    }
  });

  // POST create (admin/editor only)
  fastify.post('/', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'EDITOR', 'SUPER_ADMIN')],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = CreatePostSchema.parse(request.body);
        const { categoryId, categoryIds, tags, tagIds, content, publishedAt, ...rest } = body;

        const cats = categoryIds || (categoryId ? [categoryId] : []);

        const post = await prisma.post.create({
          data: {
            ...rest,
            content: sanitizeRichText(content),
            authorId: (request as any).user.sub,
            publishedAt: publishedAt || (rest.status === 'PUBLISHED' ? new Date() : null),
            categories: cats.length > 0 ? {
              create: cats.map((id) => ({ categoryId: id })),
            } : undefined,
            tags: tags && tags.length > 0 ? {
              create: tags.map((t) => ({
                tag: {
                  connectOrCreate: {
                    where: { name: t },
                    create: { name: t },
                  },
                },
              })),
            } : (tagIds && tagIds.length > 0 ? {
              create: tagIds.map((id) => ({ tagId: id })),
            } : undefined),
          },
        });
        return reply.status(201).send({ data: post });
      } catch (err) {
        if (err instanceof ZodError) return reply.status(400).send({ error: err.errors });
        throw err;
      }
    },
  });

  // PATCH update
  fastify.patch('/:id', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'EDITOR', 'SUPER_ADMIN')],
    handler: async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const body = UpdatePostSchema.parse(request.body);
        const { categoryId, categoryIds, tags, tagIds, content, publishedAt, ...rest } = body;

        const cats = categoryIds || (categoryId ? [categoryId] : undefined);
        const hasCatsUpdate = cats !== undefined;

        const post = await prisma.post.update({
          where: { id: request.params.id },
          data: {
            ...rest,
            ...(content && { content: sanitizeRichText(content) }),
            ...(publishedAt ? { publishedAt } : (rest.status === 'PUBLISHED' ? { publishedAt: new Date() } : {})),
            ...(hasCatsUpdate ? {
              categories: {
                deleteMany: {},
                create: cats.map((id) => ({ categoryId: id }))
              }
            } : {}),
            ...(tags && tags.length > 0 ? {
              tags: {
                deleteMany: {},
                create: tags.map((t) => ({
                  tag: {
                    connectOrCreate: {
                      where: { name: t },
                      create: { name: t }
                    }
                  }
                }))
              }
            } : {})
          },
        });
        return reply.send({ data: post });
      } catch (err) {
        if (err instanceof ZodError) return reply.status(400).send({ error: err.errors });
        throw err;
      }
    },
  });

  // DELETE post
  fastify.delete('/:id', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'SUPER_ADMIN')],
    handler: async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      await prisma.post.delete({ where: { id: request.params.id } });
      return reply.send({ message: 'Post deleted' });
    },
  });
}
