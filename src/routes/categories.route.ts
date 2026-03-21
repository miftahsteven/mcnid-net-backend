import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { authMiddleware, requireRole } from '../middlewares/auth.middleware';
import { CreateCategorySchema } from '../utils/zod-schemas';
import { ZodError } from 'zod';

export async function categoriesRoutes(fastify: FastifyInstance) {
  // GET all categories
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const categories = await prisma.category.findMany({
      orderBy: { name: 'asc' },
    });
    return reply.send({ data: categories });
  });

  // POST create category
  fastify.post('/', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'EDITOR', 'SUPER_ADMIN')],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { name } = CreateCategorySchema.parse(request.body);
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        
        const category = await prisma.category.create({
          data: { name, slug },
        });
        return reply.status(201).send({ data: category });
      } catch (err: any) {
        if (err instanceof ZodError) return reply.status(400).send({ error: err.errors });
        if (err.code === 'P2002') return reply.status(400).send({ error: 'Category already exists' });
        throw err;
      }
    },
  });
}
