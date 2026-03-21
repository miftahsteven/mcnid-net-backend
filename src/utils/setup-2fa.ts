import { PrismaClient } from '@prisma/client';
import { generateSecret, generateURI } from 'otplib';

import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const prisma = new PrismaClient();

async function setup2FA(username: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      console.error(`User with username "${username}" not found.`);
      process.exit(1);
    }

    const secret = generateSecret();
    const otpauth = generateURI({ secret, label: user.email, issuer: 'MCN Admin' });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorSecret: secret,
        twoFactorEnabled: true,
      },
    });

    console.log('--- 2FA Setup Success ---');
    console.log(`User: ${user.username} (${user.email})`);
    console.log(`Secret: ${secret}`);
    console.log(`OTPAuth URL: ${otpauth}`);
    console.log('--------------------------');
    console.log('Scan this secret or URL in your Google Authenticator app.');
    
    await prisma.$disconnect();
  } catch (error) {
    console.error('Error setting up 2FA:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

const targetUser = process.argv[2] || 'admin';
setup2FA(targetUser);
