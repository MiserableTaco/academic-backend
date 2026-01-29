import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export class EmailService {
  static async sendOTP(email: string, code: string) {
    if (!process.env.RESEND_API_KEY) {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`📧 OTP for ${email}: ${code} (expires in 3 min)`);
      console.log(`⚠️  Resend not configured - showing in console`);
      console.log(`${'='.repeat(50)}\n`);
      return;
    }

    try {
      await resend.emails.send({
        from: 'AcadCert <onboarding@resend.dev>',
        to: email,
        subject: 'Your AcadCert Login Code',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #334155;">AcadCert Verification</h2>
            <p>Your verification code is:</p>
            <div style="background: #f1f5f9; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 20px 0;">
              ${code}
            </div>
            <p style="color: #64748b; font-size: 14px;">This code expires in 3 minutes.</p>
            <p style="color: #64748b; font-size: 14px;">If you didn't request this, please ignore this email.</p>
          </div>
        `,
      });
      console.log(`✉️ Email sent to ${email}`);
    } catch (error) {
      console.error('❌ Email failed:', error);
      console.log(`📧 Fallback - OTP for ${email}: ${code}`);
    }
  }
}
