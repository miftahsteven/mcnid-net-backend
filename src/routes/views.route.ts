import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';

/**
 * View Counting Strategy:
 * - Cookie-based: 24h browser cookie "mcn_viewed" stores a JSON set of `type:slug` keys.
 * - A view is counted only once per content ID per browser session window (24h).
 * - Uses raw SQL so that it works even if Prisma client is cached before migration.
 * - No auth required — public POST endpoint.
 */

const COOKIE_NAME = 'mcn_viewed';
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours in seconds

export async function viewsRoutes(fastify: FastifyInstance) {
  // POST /api/views — Track a view for a post or video
  fastify.post(
    '/',
    async (
      request: FastifyRequest<{
        Body: { type: 'post' | 'video'; slug: string };
      }>,
      reply: FastifyReply
    ) => {
      const { type, slug } = request.body;

      if (!type || !slug || !['post', 'video'].includes(type)) {
        return reply.status(400).send({
          error: 'Invalid request: type must be "post" or "video", slug is required',
        });
      }

      // Parse cookie
      const cookieHeader = request.headers.cookie || '';
      const cookieMap: Record<string, string> = {};
      cookieHeader.split(';').forEach((part) => {
        const [k, v] = part.trim().split('=');
        if (k) cookieMap[k.trim()] = v?.trim() || '';
      });

      let viewedSet: Set<string>;
      try {
        viewedSet = new Set(JSON.parse(decodeURIComponent(cookieMap[COOKIE_NAME] || '[]')));
      } catch {
        viewedSet = new Set();
      }

      const viewKey = `${type}:${slug}`;

      // Already viewed in this session window — skip
      if (viewedSet.has(viewKey)) {
        return reply.send({ counted: false, reason: 'already_viewed' });
      }

      // Increment viewCount using raw SQL (works regardless of Prisma client cache)
      try {
        const table = type === 'post' ? 'posts' : 'videos';
        const result = await prisma.$executeRawUnsafe(
          `UPDATE "${table}" SET "viewCount" = "viewCount" + 1 WHERE slug = $1`,
          slug
        );
        if (result === 0) {
          // No rows updated = slug not found
          return reply.send({ counted: false, reason: 'not_found' });
        }
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Failed to record view' });
      }

      // Update cookie
      viewedSet.add(viewKey);
      const cookieValue = encodeURIComponent(JSON.stringify([...viewedSet]));
      reply.header(
        'Set-Cookie',
        `${COOKIE_NAME}=${cookieValue}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax; HttpOnly`
      );

      return reply.send({ counted: true });
    }
  );

  // GET /api/views/:type/:slug — Return current view count (public)
  fastify.get(
    '/:type/:slug',
    async (
      request: FastifyRequest<{ Params: { type: string; slug: string } }>,
      reply: FastifyReply
    ) => {
      const { type, slug } = request.params;

      if (!['post', 'video'].includes(type)) {
        return reply.status(400).send({ error: 'Invalid type. Must be "post" or "video".' });
      }

      try {
        const table = type === 'post' ? 'posts' : 'videos';
        const rows = await prisma.$queryRawUnsafe<{ viewCount: number }[]>(
          `SELECT "viewCount" FROM "${table}" WHERE slug = $1 LIMIT 1`,
          slug
        );
        const views = rows[0]?.viewCount ?? 0;
        return reply.send({ views: Number(views) });
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Server error' });
      }
    }
  );
}
