import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const gmailUser = process.env.GMAIL_USER || 'swyftticket@gmail.com';
const gmailPass = (process.env.GMAIL_APP_PASSWORD || 'pvnx otjj ynki pugj').replace(/\s+/g, '');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // TLS via port 587
  auth: {
    user: gmailUser,
    pass: gmailPass,
  },
});

export const sendTicketEmail = async ({
  email,
  name,
  eventName,
  ticketType,
  qrUrl,
  verificationId,
  reference,
  phone,
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
    const mailOptions = {
      from: `"SWYFT Tickets" <${gmailUser}>`,
      to: email,
      subject: `Your SWYFT Ticket & Receipt: ${eventName}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff; box-shadow: 0 4px 12px rgba(40,44,53,0.08);">
          
          <!-- Header -->
          <div style="background-color: #d1410c; padding: 28px 24px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.02em; color: #ffffff;">SWYFT</h1>
            <p style="margin: 6px 0 0 0; font-size: 13px; color: #fff2ed; font-weight: 500;">Official Campus Event Ticket & Receipt</p>
          </div>
          
          <!-- Content -->
          <div style="padding: 32px 24px;">
            <h2 style="margin-top: 0; color: #39364f; font-size: 20px; font-weight: 700;">Hi ${name},</h2>
            <p style="color: #6f7287; font-size: 14px; line-height: 1.5; margin-bottom: 24px;">
              Your order and payment were successful! Below is your official digital admission ticket and entry credentials.
            </p>
            
            <!-- Details Table -->
            <h3 style="margin: 0 0 10px 0; color: #d1410c; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
              Ticket & Billing Information
            </h3>
            
            <div style="background-color: #f8f7fa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 18px; margin-bottom: 24px;">
              <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #39364f;">
                <tr>
                  <td style="padding: 6px 0; color: #6f7287; font-weight: 500;">Attendee</td>
                  <td style="padding: 6px 0; font-weight: 700; text-align: right;">${name}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #6f7287; font-weight: 500;">Email Address</td>
                  <td style="padding: 6px 0; font-weight: 700; text-align: right;">${email}</td>
                </tr>
                ${phone ? `
                <tr>
                  <td style="padding: 6px 0; color: #6f7287; font-weight: 500;">Phone Number</td>
                  <td style="padding: 6px 0; font-weight: 700; text-align: right;">${phone}</td>
                </tr>
                ` : ''}
                <tr style="border-top: 1px solid #e5e7eb;">
                  <td style="padding: 10px 0 6px 0; color: #6f7287; font-weight: 500;">Event</td>
                  <td style="padding: 10px 0 6px 0; font-weight: 700; text-align: right; color: #d1410c;">${eventName}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #6f7287; font-weight: 500;">Ticket Type</td>
                  <td style="padding: 6px 0; font-weight: 700; text-align: right;">${ticketType}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #6f7287; font-weight: 500;">Transaction Ref</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right; font-family: monospace;">${reference}</td>
                </tr>
              </table>
            </div>

            <!-- Access QR Code Section -->
            <h3 style="margin: 0 0 10px 0; color: #d1410c; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
              Admission Verification QR Code
            </h3>
            
            <div style="background-color: #ffffff; border: 1.5px solid #e5e7eb; border-radius: 12px; padding: 24px; text-align: center;">
              <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; display: inline-block; margin-bottom: 14px;">
                <img src="${qrUrl}" alt="Ticket QR Code" width="200" height="200" style="display: block; margin: 0 auto;" />
              </div>
              
              <p style="margin: 0 0 4px 0; font-size: 11px; color: #6f7287; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
                Verification ID
              </p>
              <code style="font-family: monospace; font-size: 15px; color: #d1410c; font-weight: 800; background-color: #fff9f6; padding: 6px 12px; border-radius: 6px; border: 1px solid #fecaca; display: inline-block; word-break: break-all;">
                ${verificationId}
              </code>
              
              <p style="margin: 16px 0 0 0; font-size: 13px; color: #6f7287; line-height: 1.4;">
                Present this QR code or provide the Verification ID to the organizer at the gate for admission check-in.
              </p>
            </div>

            <!-- Footer -->
            <p style="font-size: 12px; color: #9ca3af; text-align: center; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
              Questions about this order? Contact event support at ${gmailUser}.<br>
              © ${new Date().getFullYear()} SWYFT Technologies. All rights reserved.
            </p>
          </div>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✉️ Ticket email successfully sent to ${email} (Message ID: ${info.messageId})`);
    return info;
  } catch (error) {
    console.error('❌ Error sending ticket email via Gmail SMTP:', error);
    throw error;
  }
};

export const sendVerificationEmail = async (email: string, name: string, code: string) => {
  try {
    const mailOptions = {
      from: `"SWYFT Accounts" <${gmailUser}>`,
      to: email,
      subject: 'Verify your SWYFT Account',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background: #ffffff;">
          <div style="background: #d1410c; padding: 24px; text-align: center; color: white;">
            <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 800;">SWYFT</h1>
          </div>
          <div style="padding: 32px;">
            <h2 style="margin-top: 0; color: #39364f; font-size: 18px;">Welcome to SWYFT, ${name}!</h2>
            <p style="color: #6f7287; font-size: 14px;">Please use the verification code below to activate your account:</p>
            <div style="background: #fff9f6; border: 1px solid #fecaca; padding: 18px; border-radius: 8px; text-align: center; margin: 20px 0;">
              <h1 style="letter-spacing: 8px; font-size: 32px; margin: 0; color: #d1410c;">${code}</h1>
            </div>
            <p style="color: #9ca3af; font-size: 12px;">If you didn't create an account, you can safely ignore this email.</p>
          </div>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✉️ Verification email sent to ${email} (Message ID: ${info.messageId})`);
    return info;
  } catch (error) {
    console.error('Error sending verification email (non-fatal):', error);
    return null;
  }
};
