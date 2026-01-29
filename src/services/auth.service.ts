import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { AccessAction } from '@prisma/client';
import { EmailService } from './email.service.js';

const OTP_EXPIRY_MS = 3 * 60 * 1000;

export class AuthService {
  static async requestOTP(email: string, ip = '0.0.0.0') {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { institution: true }
    });

    if (!user || user.institution.status !== 'ACTIVE') {
      throw new Error('Invalid email or institution inactive');
    }

    const code = crypto.randomInt(100000, 999999).toString();
    
    await prisma.oTPVerification.updateMany({
      where: { userId: user.id, verified: false },
      data: { expiresAt: new Date(0) }
    });

    await prisma.oTPVerification.create({
      data: {
        userId: user.id,
        email: email.toLowerCase(),
        code,
        expiresAt: new Date(Date.now() + OTP_EXPIRY_MS)
      }
    });

    await prisma.accessLog.create({
      data: { actorId: user.id, action: AccessAction.OTP_REQUEST, ipAddress: ip, metadata: { email } }
    });

    await EmailService.sendOTP(email, code);
  }

  static async verifyOTP(email: string, code: string, ip = '0.0.0.0') {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { institution: true, devices: { where: { revoked: false } } }
    });

    if (!user) throw new Error('Invalid email or code');

    const otp = await prisma.oTPVerification.findFirst({
      where: { userId: user.id, code, verified: false },
      orderBy: { createdAt: 'desc' }
    });

    if (!otp) throw new Error('Invalid code');
    if (otp.expiresAt < new Date()) throw new Error('Code expired (3 min limit)');
    if (otp.attempts >= 5) throw new Error('Too many attempts');

    await prisma.oTPVerification.update({
      where: { id: otp.id },
      data: { verified: true }
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { verified: true, lastLoginAt: new Date() }
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        institutionId: user.institutionId,
        institutionName: user.institution.name
      },
      requiresDeviceRegistration: user.devices.length === 0
    };
  }

  static generateJWTPayload(user: any) {
    return { userId: user.id, email: user.email, role: user.role, institutionId: user.institutionId };
  }
}
