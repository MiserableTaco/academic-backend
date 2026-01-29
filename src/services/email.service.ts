import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export class EmailService {
  static async sendOTP(email: string, code: string) {
    if (!process.env.RESEND_API_KEY) {
      console.log('\n╔════════════════════════════════════╗');
      console.log('║     OTP VERIFICATION CODE          ║');
      console.log('╠════════════════════════════════════╣');
      console.log(`║  Email: ${email.padEnd(26)} ║`);
      console.log(`║  Code:  ${code.padEnd(26)} ║`);
      console.log(`║  Expires in: 3 minutes             ║`);
      console.log('╚════════════════════════════════════╝\n');
      return { success: true, method: 'console' };
    }

    try {
      const { data, error } = await resend.emails.send({
        from: 'AcadCert <onboarding@resend.dev>',
        to: [email],
        subject: 'Your AcadCert Verification Code',
        html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px;">
              <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <div style="background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%); padding: 40px 20px; text-align: center;">
                  <h1 style="color: white; margin: 0; font-size: 28px; font-weight: bold;">AcadCert</h1>
                  <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">Secure Document Verification</p>
                </div>
                <div style="padding: 40px 30px;">
                  <h2 style="color: #1f2937; margin: 0 0 20px 0; font-size: 24px;">Your Verification Code</h2>
                  <p style="color: #4b5563; line-height: 1.6; margin: 0 0 30px 0; font-size: 16px;">
                    Use the code below to complete your login. This code will expire in <strong>3 minutes</strong>.
                  </p>
                  <div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border: 2px solid #3b82f6; border-radius: 12px; padding: 30px; text-align: center; margin: 0 0 30px 0;">
                    <div style="color: #1e40af; font-size: 48px; font-weight: bold; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                      ${code}
                    </div>
                  </div>
                  <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 4px; margin: 0 0 30px 0;">
                    <p style="color: #92400e; margin: 0; font-size: 14px; line-height: 1.5;">
                      <strong>Security Notice:</strong> Never share this code with anyone.
                    </p>
                  </div>
                </div>
                <div style="background-color: #f9fafb; padding: 20px 30px; border-top: 1px solid #e5e7eb;">
                  <p style="color: #9ca3af; font-size: 12px; margin: 0; text-align: center;">
                    © 2026 AcadCert. All rights reserved.
                  </p>
                </div>
              </div>
            </body>
          </html>
        `,
      });

      if (error) {
        console.error('❌ Resend error:', error);
        console.log(`\n📧 Email failed, using console fallback`);
        console.log(`   Email: ${email}`);
        console.log(`   Code: ${code}\n`);
        return { success: false, method: 'console-fallback', error };
      }

      console.log(`✅ Email sent to ${email} via Resend`);
      return { success: true, method: 'resend', data };
    } catch (error) {
      console.error('❌ Resend exception:', error);
      console.log(`\n📧 Email exception, using console fallback`);
      console.log(`   Email: ${email}`);
      console.log(`   Code: ${code}\n`);
      return { success: false, method: 'console-fallback', error };
    }
  }

  static async sendDocumentIssued(email: string, documentType: string, institutionName: string) {
    if (!process.env.RESEND_API_KEY) {
      console.log('\n📄 Document issued notification (console):');
      console.log(`   To: ${email}`);
      console.log(`   Type: ${documentType}`);
      console.log(`   From: ${institutionName}\n`);
      return { success: true, method: 'console' };
    }

    try {
      const { data, error } = await resend.emails.send({
        from: 'AcadCert <onboarding@resend.dev>',
        to: [email],
        subject: `New Document Available: ${documentType}`,
        html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px;">
              <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 20px; text-align: center;">
                  <h1 style="color: white; margin: 0; font-size: 28px; font-weight: bold;">🎓 New Document Available</h1>
                </div>
                <div style="padding: 40px 30px;">
                  <h2 style="color: #1f2937; margin: 0 0 20px 0; font-size: 24px;">Document Issued</h2>
                  <p style="color: #4b5563; line-height: 1.6; margin: 0 0 20px 0; font-size: 16px;">
                    Good news! A new document has been issued to you.
                  </p>
                  <div style="background: #f0fdf4; border: 2px solid #10b981; border-radius: 12px; padding: 20px; margin: 0 0 30px 0;">
                    <p style="margin: 0 0 10px 0; color: #065f46;"><strong>Document Type:</strong> ${documentType}</p>
                    <p style="margin: 0; color: #065f46;"><strong>Issued By:</strong> ${institutionName}</p>
                  </div>
                  <p style="color: #4b5563; line-height: 1.6; margin: 0 0 20px 0; font-size: 16px;">
                    Log in to AcadCert to view, download, and verify your document.
                  </p>
                </div>
                <div style="background-color: #f9fafb; padding: 20px 30px; border-top: 1px solid #e5e7eb;">
                  <p style="color: #9ca3af; font-size: 12px; margin: 0; text-align: center;">
                    © 2026 AcadCert. Secured with RSA-4096 cryptographic signatures.
                  </p>
                </div>
              </div>
            </body>
          </html>
        `,
      });

      if (error) {
        console.error('❌ Document notification error:', error);
        return { success: false, error };
      }

      console.log(`✅ Document notification sent to ${email}`);
      return { success: true, data };
    } catch (error) {
      console.error('❌ Document notification exception:', error);
      return { success: false, error };
    }
  }
}
