import { prisma } from '../lib/prisma.js';
import { EmailService } from './email.service.js';
import crypto from 'crypto';

export class AuthService {
  static async requestOTP(email: string): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();

    let user = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (!user) {
      const domain = normalizedEmail.split('@')[1];
      
      const institution = await prisma.institution.findFirst({
        where: { emailDomain: domain }
      });

      if (!institution) {
        throw new Error('No institution found for this email domain');
      }

      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          institutionId: institution.id,
          role: 'STUDENT',
          verified: false
        }
      });
    }

    if (user.revokedAt) {
      throw new Error('User access has been revoked');
    }

    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000);

    await prisma.oTPCode.deleteMany({
      where: { userId: user.id }
    });

    await prisma.oTPCode.create({
      data: {
        userId: user.id,
        code,
        expiresAt
      }
    });

    await EmailService.sendOTP(normalizedEmail, code);
  }

  static async verifyOTP(email: string, code: string) {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { institution: true }
    });

    if (!user) {
      throw new Error('User not found');
    }

    const otp = await prisma.oTPCode.findFirst({
      where: {
        userId: user.id,
        code,
        expiresAt: { gte: new Date() }
      }
    });

    if (!otp) {
      throw new Error('Invalid or expired code');
    }

    await prisma.oTPCode.delete({
      where: { id: otp.id }
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { verified: true }
    });

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      institutionId: user.institutionId
    };
  }
}
