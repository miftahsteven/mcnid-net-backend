import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { authMiddleware, requireRole } from '../middlewares/auth.middleware';

export async function coursesRoutes(fastify: FastifyInstance) {

  // ─── PUBLIC ROUTES ──────────────────────────────────────────────────────────

  // GET all published courses
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const courses = await prisma.course.findMany({
      where: { status: 'PUBLISHED' },
      select: {
        id: true, title: true, slug: true, description: true,
        coverImage: true, category: true, level: true,
        durationHours: true, price: true, hasCertificate: true,
        status: true, createdAt: true,
        author: { select: { name: true } },
        _count: { select: { modules: true, enrollments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send({ data: courses });
  });

  // GET single course by slug (public)
  fastify.get('/:slug', async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
    const course = await prisma.course.findUnique({
      where: { slug: request.params.slug, status: 'PUBLISHED' },
      include: {
        author: { select: { name: true, image: true } },
        modules: {
          orderBy: { order: 'asc' },
          include: {
            lessons: {
              orderBy: { order: 'asc' },
              select: { id: true, title: true, type: true, durationMin: true, isFree: true, order: true },
            },
          },
        },
        _count: { select: { enrollments: true } },
      },
    });
    if (!course) return reply.status(404).send({ error: 'Course not found' });
    return reply.send({ data: course });
  });

  // ─── ADMIN ROUTES ───────────────────────────────────────────────────────────

  // GET all courses (all statuses) — admin
  fastify.get('/admin/all', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'EDITOR', 'SUPER_ADMIN', 'PENGAJAR')],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const where = user.role === 'PENGAJAR' ? { authorId: user.sub } : {};

      const courses = await prisma.course.findMany({
        where,
        select: {
          id: true, title: true, slug: true, coverImage: true,
          category: true, level: true, price: true, hasCertificate: true,
          status: true, durationHours: true, createdAt: true,
          author: { select: { name: true } },
          _count: { select: { modules: true, enrollments: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send({ data: courses });
    },
  });

  // GET single course by ID — admin
  fastify.get('/admin/:id', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'EDITOR', 'SUPER_ADMIN', 'PENGAJAR')],
    handler: async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const course = await prisma.course.findUnique({
        where: { id: request.params.id },
        include: {
          author: { select: { name: true } },
          modules: {
            orderBy: { order: 'asc' },
            include: {
              lessons: { orderBy: { order: 'asc' } },
            },
          },
        },
      });
      if (!course) return reply.status(404).send({ error: 'Course not found' });
      return reply.send({ data: course });
    },
  });

  // POST create course — admin
  fastify.post('/', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'EDITOR', 'SUPER_ADMIN', 'PENGAJAR')],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const body = request.body as any;

      if (!body.title) return reply.status(400).send({ error: 'Title is required' });

      const slug = body.slug ||
        body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now();

      const course = await prisma.course.create({
        data: {
          title: body.title,
          slug,
          description: body.description,
          coverImage: body.coverImage,
          category: body.category || 'Umum',
          level: body.level || 'Pemula',
          durationHours: body.durationHours ? parseFloat(body.durationHours) : null,
          price: body.price !== undefined ? parseFloat(body.price) : 0,
          hasCertificate: body.hasCertificate || false,
          status: body.status || 'DRAFT',
          authorId: user.sub,
        },
      });
      return reply.status(201).send({ data: course });
    },
  });

  // PUT update course — admin
  fastify.put('/:id', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'EDITOR', 'SUPER_ADMIN', 'PENGAJAR')],
    handler: async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const body = request.body as any;
      const { id } = request.params;

      const existing = await prisma.course.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: 'Course not found' });

      const slug = body.slug || body.title
        ? (body.title || existing.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
        : existing.slug;

      const course = await prisma.course.update({
        where: { id },
        data: {
          title: body.title ?? existing.title,
          slug,
          description: body.description ?? existing.description,
          coverImage: body.coverImage ?? existing.coverImage,
          category: body.category ?? existing.category,
          level: body.level ?? existing.level,
          durationHours: body.durationHours !== undefined ? parseFloat(body.durationHours) : existing.durationHours,
          price: body.price !== undefined ? parseFloat(body.price) : existing.price,
          hasCertificate: body.hasCertificate ?? existing.hasCertificate,
          status: body.status ?? existing.status,
        },
      });
      return reply.send({ data: course });
    },
  });

  // DELETE course — admin
  fastify.delete('/:id', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'SUPER_ADMIN', 'PENGAJAR')],
    handler: async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      await prisma.course.delete({ where: { id: request.params.id } });
      return reply.send({ success: true });
    },
  });

  // ─── MODULE ROUTES ──────────────────────────────────────────────────────────

  // POST add module to course
  fastify.post('/:courseId/modules', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'EDITOR', 'SUPER_ADMIN', 'PENGAJAR')],
    handler: async (request: FastifyRequest<{ Params: { courseId: string } }>, reply: FastifyReply) => {
      const body = request.body as any;
      if (!body.title) return reply.status(400).send({ error: 'Module title is required' });

      const lastModule = await prisma.courseModule.findFirst({
        where: { courseId: request.params.courseId },
        orderBy: { order: 'desc' },
      });

      const module = await prisma.courseModule.create({
        data: {
          title: body.title,
          order: lastModule ? lastModule.order + 1 : 0,
          courseId: request.params.courseId,
        },
        include: { lessons: true },
      });
      return reply.status(201).send({ data: module });
    },
  });

  // PUT update module
  fastify.put('/modules/:moduleId', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'EDITOR', 'SUPER_ADMIN', 'PENGAJAR')],
    handler: async (request: FastifyRequest<{ Params: { moduleId: string } }>, reply: FastifyReply) => {
      const body = request.body as any;
      const module = await prisma.courseModule.update({
        where: { id: request.params.moduleId },
        data: { title: body.title, order: body.order },
      });
      return reply.send({ data: module });
    },
  });

  // DELETE module
  fastify.delete('/modules/:moduleId', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'EDITOR', 'SUPER_ADMIN', 'PENGAJAR')],
    handler: async (request: FastifyRequest<{ Params: { moduleId: string } }>, reply: FastifyReply) => {
      await prisma.courseModule.delete({ where: { id: request.params.moduleId } });
      return reply.send({ success: true });
    },
  });

  // ─── LESSON ROUTES ──────────────────────────────────────────────────────────

  // POST add lesson to module
  fastify.post('/modules/:moduleId/lessons', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'EDITOR', 'SUPER_ADMIN', 'PENGAJAR')],
    handler: async (request: FastifyRequest<{ Params: { moduleId: string } }>, reply: FastifyReply) => {
      const body = request.body as any;
      if (!body.title) return reply.status(400).send({ error: 'Lesson title is required' });

      const lastLesson = await prisma.lesson.findFirst({
        where: { moduleId: request.params.moduleId },
        orderBy: { order: 'desc' },
      });

      const lesson = await prisma.lesson.create({
        data: {
          title: body.title,
          type: body.type || 'VIDEO',
          content: body.content,
          videoUrl: body.videoUrl,
          fileUrl: body.fileUrl,
          durationMin: body.durationMin ? parseInt(body.durationMin) : null,
          isFree: body.isFree || false,
          order: lastLesson ? lastLesson.order + 1 : 0,
          moduleId: request.params.moduleId,
        },
      });
      return reply.status(201).send({ data: lesson });
    },
  });

  // PUT update lesson
  fastify.put('/lessons/:lessonId', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'EDITOR', 'SUPER_ADMIN', 'PENGAJAR')],
    handler: async (request: FastifyRequest<{ Params: { lessonId: string } }>, reply: FastifyReply) => {
      const body = request.body as any;
      const existing = await prisma.lesson.findUnique({ where: { id: request.params.lessonId } });
      if (!existing) return reply.status(404).send({ error: 'Lesson not found' });

      const lesson = await prisma.lesson.update({
        where: { id: request.params.lessonId },
        data: {
          title: body.title ?? existing.title,
          type: body.type ?? existing.type,
          content: body.content ?? existing.content,
          videoUrl: body.videoUrl ?? existing.videoUrl,
          fileUrl: body.fileUrl ?? existing.fileUrl,
          durationMin: body.durationMin !== undefined ? parseInt(body.durationMin) : existing.durationMin,
          isFree: body.isFree ?? existing.isFree,
          order: body.order ?? existing.order,
        },
      });
      return reply.send({ data: lesson });
    },
  });

  // DELETE lesson
  fastify.delete('/lessons/:lessonId', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'EDITOR', 'SUPER_ADMIN', 'PENGAJAR')],
    handler: async (request: FastifyRequest<{ Params: { lessonId: string } }>, reply: FastifyReply) => {
      await prisma.lesson.delete({ where: { id: request.params.lessonId } });
      return reply.send({ success: true });
    },
  });
}
