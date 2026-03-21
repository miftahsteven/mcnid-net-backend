import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';

export interface AuthPayload {
  sub: string;
  email: string;
  role: string;
}

// Evaluate at runtime to avoid import hoisting issues with dotenv
const getJwtSecret = () => process.env.JWT_SECRET || 'changeme_in_production';

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const authHeader = request.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error("Auth header missing or invalid:", request.headers);
    return reply.status(401).send({ error: 'Unauthorized: Missing token' });
  }

  // Block Postman and cURL
  const userAgent = request.headers['user-agent']?.toLowerCase() || '';
  if (userAgent.includes('postman') || userAgent.includes('curl')) {
    return reply.status(403).send({ error: 'Forbidden: Access from this client is not allowed' });
  }

  // Optional Origin/Referer check (allow undefined for now if SSR, but usually present from browsers)
  const origin = request.headers.origin || request.headers.referer || '';
  if (origin && !origin.includes(process.env.FRONTEND_URL?.replace(/^https?:\/\//, '') || 'localhost')) {
    // We only block if origin is explicitly present but doesn't match our frontend URL or localhost
    // This adds extra security against external domains using stolen tokens
    return reply.status(403).send({ error: 'Forbidden: Invalid Origin' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, getJwtSecret()) as AuthPayload;
    (request as any).user = payload;
  } catch (err: any) {
    console.error("JWT Verification failed:", err.message);
    return reply.status(401).send({ error: 'Unauthorized: Invalid or expired token' });
  }
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user as AuthPayload | undefined;
    if (!user || !roles.includes(user.role)) {
      return reply.status(403).send({ error: 'Forbidden: Insufficient permissions' });
    }
  };
}
