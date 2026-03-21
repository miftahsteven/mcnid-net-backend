import { FastifyRequest, FastifyReply } from 'fastify';

export async function internalApiMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const apiKey = request.headers['x-api-key'];
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey) {
    request.log.warn('INTERNAL_API_KEY is not configured in environment variables');
    // If not configured, we might allow it or block it. Block it by default for security.
    return reply.status(500).send({ error: 'Server misconfiguration: missing INTERNAL_API_KEY' });
  }

  if (!apiKey || apiKey !== expectedKey) {
    return reply.status(403).send({ error: 'Forbidden: Invalid or missing API Key' });
  }
}
