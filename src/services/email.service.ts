import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendTicketEmail = async ({
  email,
  name,
  eventName,
  ticketType,
  qrUrl,
  verificationId,
  reference,
  phone,
  matricNumber,
}: {
  email: string;
  name: string;
  eventName: string;
  ticketType: string;
  qrUrl: string;
  verificationId: string;
  reference: string;
  phone?: string;
  matricNumber?: string;
}) => {
  try {
    const data = await resend.emails.send({
      from: 'OTIX <tickets@otix.example.com>',
      to: [email],
      subject: `Your OTIX Ticket & Receipt: ${eventName}`,
      html: `
        <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); padding: 32px 24px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 28px; font-weight: 800; letter-spacing: 0.05em; color: #ffffff;">OTIX</h1>
            <p style="margin: 8px 0 0 0; font-size: 14px; color: #e0e7ff; font-weight: 500;">Campus Event Ticketing & Voting</p>
          </div>
          
          <!-- Content -->
          <div style="padding: 32px 24px;">
            <h2 style="margin-top: 0; color: #111827; font-size: 20px; font-weight: 700;">Hi ${name},</h2>
            <p style="color: #4b5563; font-size: 15px; line-height: 1.5; margin-bottom: 24px;">Your order and payment were successful! Below is your official ticket receipt and access verification credentials.</p>
            
            <!-- Receipt Header -->
            <h3 style="margin: 0 0 12px 0; color: #4F46E5; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">Ticket & Billing Details</h3>
            
            <!-- Details Grid/Table -->
            <div style="background-color: #f9fafb; border: 1px solid #f3f4f6; border-radius: 12px; padding: 20px; margin-bottom: 28px;">
              <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <tr>
                  <td style="padding: 6px 0; color: #6b7280; font-weight: 500;">Attendee Name</td>
                  <td style="padding: 6px 0; color: #111827; font-weight: 700; text-align: right;">${name}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #6b7280; font-weight: 500;">Email Address</td>
                  <td style="padding: 6px 0; color: #111827; font-weight: 700; text-align: right;">${email}</td>
                </tr>
                ${phone ? `
                <tr>
                  <td style="padding: 6px 0; color: #6b7280; font-weight: 500;">Phone Number</td>
                  <td style="padding: 6px 0; color: #111827; font-weight: 700; text-align: right;">${phone}</td>
                </tr>
                ` : ''}
                ${matricNumber ? `
                <tr>
                  <td style="padding: 6px 0; color: #6b7280; font-weight: 500;">Matric Number</td>
                  <td style="padding: 6px 0; color: #111827; font-weight: 700; text-align: right;">${matricNumber}</td>
                </tr>
                ` : ''}
                <tr style="border-top: 1px solid #e5e7eb;">
                  <td style="padding: 12px 0 6px 0; color: #6b7280; font-weight: 500;">Event</td>
                  <td style="padding: 12px 0 6px 0; color: #111827; font-weight: 700; text-align: right;">${eventName}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #6b7280; font-weight: 500;">Ticket Type</td>
                  <td style="padding: 6px 0; color: #111827; font-weight: 700; text-align: right;">${ticketType}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #6b7280; font-weight: 500;">Transaction Ref</td>
                  <td style="padding: 6px 0; color: #111827; font-weight: 700; text-align: right; font-family: monospace;">${reference}</td>
                </tr>
              </table>
            </div>

            <!-- Verification / QR Code Section -->
            <h3 style="margin: 0 0 12px 0; color: #4F46E5; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">Access Verification</h3>
            
            <div style="background-color: #FFFDF9; border: 1.5px solid #FDE68A; border-radius: 16px; padding: 24px; text-align: center;">
              <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px; display: inline-block; margin-bottom: 16px; box-shadow: 0 1px 3px 0 rgba(0,0,0,0.05);">
                <img src="${qrUrl}" alt="Verification QR Code" width="200" height="200" style="display: block; margin: 0 auto;" />
              </div>
              
              <p style="margin: 0 0 4px 0; font-size: 11px; color: #9ca3af; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Verification ID</p>
              <code style="font-family: monospace; font-size: 15px; color: #b45309; font-weight: 800; background-color: #fef3c7; padding: 4px 8px; border-radius: 6px; border: 1px solid #fde68a; display: inline-block; word-break: break-all;">${verificationId}</code>
              
              <p style="margin: 16px 0 0 0; font-size: 13px; color: #6b7280; line-height: 1.4;">Present this QR code or provide the Verification ID to the organizer at the entrance gate for quick verification and check-in.</p>
            </div>

            <!-- Footer -->
            <p style="font-size: 12px; color: #9ca3af; text-align: center; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
              Have questions or need help? Contact support at support@otix.example.com.<br>
              © 2026 OTIX. All rights reserved.
            </p>
          </div>
        </div>
      `,
    });
    return data;
  } catch (error) {
    console.error('Error sending email', error);
    throw error;
  }
};

export const sendVerificationEmail = async (email: string, name: string, code: string) => {
  try {
    const data = await resend.emails.send({
      from: 'OTIX <verify@otix.example.com>',
      to: [email],
      subject: 'Verify your OTIX Account',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
          <div style="background: #4F46E5; padding: 24px; text-align: center;">
            <h1 style="color: white; margin: 0;">OTIX</h1>
          </div>
          <div style="padding: 32px;">
            <h2 style="margin-top: 0;">Welcome to OTIX, ${name}!</h2>
            <p>Please use the verification code below to activate your account:</p>
            <div style="background: #f9fafb; padding: 20px; border-radius: 8px; text-align: center; margin: 24px 0;">
              <h1 style="letter-spacing: 12px; font-size: 36px; margin: 0; color: #4F46E5;">${code}</h1>
            </div>
            <p>If you didn't create an account, you can safely ignore this email.</p>
          </div>
        </div>
      `,
    });
    return data;
  } catch (error) {
    console.error('Error sending verification email', error);
    throw error;
  }
};
