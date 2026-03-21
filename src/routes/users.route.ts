import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { authMiddleware, requireRole } from '../middlewares/auth.middleware';

export default async function userRoutes(fastify: FastifyInstance) {
  // Apply auth and admin role requirements to all routes in this plugin
  fastify.addHook('onRequest', authMiddleware);
  fastify.addHook('onRequest', requireRole('SUPER_ADMIN', 'ADMIN'));

  /**
   * GET /api/admin/users
   * List all users
   */
  fastify.get('/', async (request, reply) => {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          role: true,
          twoFactorEnabled: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send({ data: users });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/admin/users
   * Create a new user
   */
  fastify.post<{
    Body: { name: string; email: string; role: string; password?: string };
  }>('/', async (request, reply) => {
    const { name, email, role, password } = request.body;

    if (!name || !email || !role) {
      return reply.status(400).send({ error: 'Name, email, and role are required' });
    }

    try {
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return reply.status(400).send({ error: 'Email already registered' });
      }

      // If password is not provided, generate a default one or leave it empty?
      // Since Google Authenticator is required, they still need a password to log in.
      // E.g. default password "mcn12345"
      const plainPassword = password || 'mcn12345';
      const passwordHash = await bcrypt.hash(plainPassword, 10);

      const newUser = await prisma.user.create({
        data: {
          name,
          email,
          username: email.split('@')[0] + Math.floor(Math.random() * 1000), // Simple default username
          role: role as any,
          passwordHash,
          twoFactorEnabled: false, // Force them to set up 2FA via zero-secret
          twoFactorSecret: null,
        },
        select: { id: true, name: true, email: true, role: true },
      });

      return reply.status(201).send({ data: newUser, defaultPassword: password ? undefined : plainPassword });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to create user' });
    }
  });

  /**
   * PUT /api/admin/users/:id
   * Update an existing user
   */
  fastify.put<{
    Params: { id: string };
    Body: { name?: string; email?: string; role?: string; password?: string };
  }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const { name, email, role, password } = request.body;

    try {
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) return reply.status(404).send({ error: 'User not found' });

      // Prevent changing another user's email to one that already exists
      if (email && email !== user.email) {
        const emailTaken = await prisma.user.findUnique({ where: { email } });
        if (emailTaken) return reply.status(400).send({ error: 'Email already in use' });
      }

      const updateData: any = {
        name: name ?? undefined,
        email: email ?? undefined,
        role: role ? (role as any) : undefined,
      };

      if (password) {
        updateData.passwordHash = await bcrypt.hash(password, 10);
      }

      const updatedUser = await prisma.user.update({
        where: { id },
        data: updateData,
        select: { id: true, name: true, email: true, role: true },
      });

      return reply.send({ data: updatedUser });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to update user' });
    }
  });

  /**
   * DELETE /api/admin/users/:id
   * Delete a user
   */
  fastify.delete<{
    Params: { id: string };
  }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const authUser = (request as any).user;

    if (id === authUser.sub) {
      return reply.status(400).send({ error: 'Cannot delete your own account' });
    }

    try {
      await prisma.user.delete({ where: { id } });
      return reply.send({ success: true, message: 'User deleted' });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to delete user' });
    }
  });

  /**
   * POST /api/admin/users/:id/reset-2fa
   * Reset the 2FA secret for a user so they can scan the QR code again.
   */
  fastify.post<{
    Params: { id: string };
  }>('/:id/reset-2fa', async (request, reply) => {
    const { id } = request.params;

    try {
      const updatedUser = await prisma.user.update({
        where: { id },
        data: {
          twoFactorSecret: null,
          twoFactorEnabled: false,
        },
        select: { id: true, name: true, email: true, twoFactorEnabled: true },
      });

      return reply.send({ 
        success: true, 
        message: '2FA has been reset. The user will be prompted to set it up on their next login.',
        data: updatedUser
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to reset 2FA' });
    }
  });
}
