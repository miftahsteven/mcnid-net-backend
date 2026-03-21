import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { generateSecret, generateURI, verify } from 'otplib';

// Evaluate at runtime to avoid import hoisting issues with dotenv
const getJwtSecret = () => process.env.JWT_SECRET || 'changeme_in_production';
const JWT_EXPIRES_IN = '8h';
const MFA_TEMP_EXPIRES_IN = '5m';

export async function authRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/auth/login
   * Body: { username: string; password: string }
   * Returns: { token: string; user: { id, name, username, role } }
   * OR { mfa_required: true, temp_token: string }
   */
  fastify.post<{
    Body: { username: string; password: string };
  }>(
    '/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', minLength: 1 },
            password: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { username, password } = request.body;

      // Find user by username
      const user = await prisma.user.findUnique({
        where: { username: username },
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          role: true,
          passwordHash: true,
          twoFactorSecret: true,
          twoFactorEnabled: true,
        },
      });

      console.log("Login attempt for", username, "User found:", !!user);

      if (!user || !user.passwordHash) {
        return reply.status(401).send({ error: 'Kredensial tidak valid' });
      }

      // Verify password
      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        return reply.status(401).send({ error: 'Kredensial tidak valid' });
      }

      let isSetup = !user.twoFactorEnabled;
      let finalSecret = user.twoFactorSecret;
      let otpauthUrl = '';

      if (!finalSecret) {
         finalSecret = generateSecret();
         await prisma.user.update({
           where: { id: user.id },
           data: { twoFactorSecret: finalSecret }
         });
      }

      if (isSetup) {
         otpauthUrl = generateURI({ label: user.email || user.username || 'User', issuer: 'MCN Admin', secret: finalSecret });
      }

      // 2FA is strictly mandatory for all admins.
      // Generate a temporary token for MFA (short-lived)
      const tempToken = jwt.sign(
        { sub: user.id, mfa: true },
        getJwtSecret(),
        { expiresIn: MFA_TEMP_EXPIRES_IN }
      );

      return reply.send({
        mfa_required: true,
        mfa_setup_required: isSetup,
        temp_token: tempToken,
        otpauth_url: isSetup ? otpauthUrl : undefined,
        secret: isSetup ? finalSecret : undefined
      });
    }
  );

  /**
   * POST /api/auth/verify-otp
   * Body: { totp_code: string; temp_token: string }
   */
  fastify.post<{
    Body: { totp_code: string; temp_token: string };
  }>(
    '/verify-otp',
    {
      schema: {
        body: {
          type: 'object',
          required: ['totp_code', 'temp_token'],
          properties: {
            totp_code: { type: 'string', minLength: 6, maxLength: 6 },
            temp_token: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { totp_code, temp_token } = request.body;

      try {
        // Verify temp token
        const decoded = jwt.verify(temp_token, getJwtSecret()) as { sub: string, mfa: boolean };
        
        if (!decoded.mfa) {
          return reply.status(401).send({ error: 'Token tidak valid' });
        }

        const user = await prisma.user.findUnique({
          where: { id: decoded.sub },
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
            role: true,
            twoFactorSecret: true,
          },
        });

        if (!user || !user.twoFactorSecret) {
          return reply.status(401).send({ error: 'User tidak ditemukan atau 2FA nonaktif' });
        }

        // Verify TOTP code
        const otpResult = await verify({ token: totp_code, secret: user.twoFactorSecret });
        if (!otpResult.valid) {
          return reply.status(401).send({ error: 'Kode OTP tidak valid' });
        }

        // Enable 2FA if it was disabled (first time setup)
        const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
        if (dbUser && !dbUser.twoFactorEnabled) {
          await prisma.user.update({
            where: { id: user.id },
            data: { twoFactorEnabled: true }
          });
        }

        // Sign final JWT
        const token = jwt.sign(
          {
            sub: user.id,
            email: user.email,
            role: user.role,
            username: user.username,
            name: user.name,
          },
          getJwtSecret(),
          { expiresIn: JWT_EXPIRES_IN }
        );

        return reply.send({
          token,
          user: {
            id: user.id,
            name: user.name,
            username: user.username,
            role: user.role,
          },
        });
      } catch (err) {
        return reply.status(401).send({ error: 'Sesi MFA kadaluarsa' });
      }
    }
  );

  /**
   * POST /api/auth/logout
   */
  fastify.post('/logout', async (request, reply) => {
    // We rely on frontend clearing cookies, but we can do any backend cleanup here if needed
    return reply.send({ success: true, message: 'Logged out successfully' });
  });
}
