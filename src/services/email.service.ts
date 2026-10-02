import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import QRCode from 'qrcode';
import dns from 'dns';
import { Resend } from 'resend';
import { generateTicketPdf } from './pdf.service';

// Enforce IPv4 first to prevent ISP IPv6 routing timeouts to smtp.gmail.com
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {
  // Ignore on older node versions if unsupported
}

dotenv.config();

const resendApiKey = process.env.RESEND_API_KEY;
const resendFrom = process.env.RESEND_FROM || 'Swyft Tickets <info@swyft-ticket.name.ng>';
const resendClient = resendApiKey ? new Resend(resendApiKey) : null;

const gmailUser = process.env.GMAIL_USER || 'swyftticket@gmail.com';
const gmailPass = (process.env.GMAIL_APP_PASSWORD || 'pvnx otjj ynki pugj').replace(/\s+/g, '');

const transporter = nodemailer.createTransport({
  pool: true,
  maxConnections: 3,
  maxMessages: 100,
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // TLS
  auth: {
    user: gmailUser,
    pass: gmailPass,
  },
  connectionTimeout: 20000,
  greetingTimeout: 15000,
  socketTimeout: 30000,
  lookup: (hostname: string, options: any, callback?: any) => {
    const cb = typeof options === 'function' ? options : callback;
    dns.lookup(hostname, { family: 4 }, cb);
  },
} as any);

/**
 * High-deliverability email dispatcher:
 * Prioritizes Resend API (prevents spam folder flagging and cloud SMTP blocking),
 * and automatically falls back to Nodemailer SMTP with retries.
 */
const sendWithRetry = async (mailOptions: any, maxRetries = 3): Promise<any> => {
  if (resendClient) {
    try {
      const attachments = mailOptions.attachments?.map((att: any) => ({
        filename: att.filename,
        content: Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content),
      }));

      const toAddress = Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to];

      const { data, error } = await resendClient.emails.send({
        from: resendFrom,
        to: toAddress,
        subject: mailOptions.subject,
        html: mailOptions.html,
        text: mailOptions.text,
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
      });

      if (!error && data?.id) {
        console.log(`🚀 Email dispatched via Resend to ${toAddress.join(', ')} (ID: ${data.id})`);
        return { messageId: data.id, resend: true };
      }
      console.warn('⚠️ Resend returned error, falling back to SMTP:', error);
    } catch (err: any) {
      console.warn(`⚠️ Resend attempt failed: ${err.message}. Falling back to SMTP...`);
    }
  }

  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await transporter.sendMail(mailOptions);
    } catch (err: any) {
      lastError = err;
      console.warn(`⚠️ SMTP attempt ${attempt}/${maxRetries} failed: ${err.message}. ${attempt < maxRetries ? 'Retrying in 2s...' : ''}`);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  throw lastError;
};

export interface ReceiptItem {
  name?: string;
  ticketName?: string;
  quantity: number;
  price: number;
}

export interface SendReceiptParams {
  email: string;
  name: string;
  eventName: string;
  reference: string;
  amount: number;
  orderId: string;
  phone?: string;
  items?: ReceiptItem[];
}

/**
 * 1. TRANSACTION RECEIPT EMAIL (Sent First)
 */
export const sendOrderReceiptEmail = async ({
  email,
  name,
  eventName,
  reference,
  amount,
  orderId,
  phone,
  items = [],
}: SendReceiptParams) => {
  try {
    const formattedAmount = `₦${amount.toLocaleString()}`;
    const purchaseDate = new Date().toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const textContent = `Order Confirmed!\n\nYou're all set. Your ticket passes and transaction receipt have been generated below.\n\nOrder Date: ${purchaseDate}\nBilled To: ${name}\nEvent: ${eventName}\nReference: ${reference}\nTotal Paid: ${formattedAmount}\n\nYour digital tickets and downloadable PDF admission passes have also been sent to your email.`;

    const mailOptions = {
      from: `"Swyft Tickets" <${gmailUser}>`,
      replyTo: `"Swyft Support" <${gmailUser}>`,
      to: email,
      subject: `Order Confirmed: ${eventName} (Ref: ${reference})`,
      text: textContent,
      headers: {
        'X-Auto-Response-Suppress': 'OOF, AutoReply',
      },
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff; box-shadow: 0 4px 14px rgba(40,44,53,0.08);">
          
          <!-- Top Brand Header -->
          <div style="background-color: #d1410c; padding: 28px 24px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.02em; color: #ffffff;">SWYFT</h1>
            <p style="margin: 6px 0 0 0; font-size: 13px; color: #fff2ed; font-weight: 500;">Campus Events & Ticketing Marketplace</p>
          </div>
          
          <!-- Main Content -->
          <div style="padding: 32px 24px;">
            <div style="background-color: #fff9f6; border-left: 4px solid #d1410c; padding: 16px 20px; border-radius: 6px; margin-bottom: 24px;">
              <h2 style="margin: 0 0 6px 0; color: #39364f; font-size: 20px; font-weight: 700;">Order Confirmed!</h2>
              <p style="margin: 0; color: #6f7287; font-size: 14px; line-height: 1.5;">
                You're all set. Your ticket passes and transaction receipt have been generated below.
              </p>
            </div>

            <!-- Receipt Breakdown -->
            <h3 style="margin: 0 0 12px 0; color: #39364f; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
              Transaction Summary
            </h3>
            
            <div style="background-color: #f8f7fa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 18px; margin-bottom: 24px;">
              <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #39364f;">
                <tr>
                  <td style="padding: 6px 0; color: #6f7287;">Order Date</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right;">${purchaseDate}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #6f7287;">Billed To</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right;">${name}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #6f7287;">Email Address</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right;">${email}</td>
                </tr>
                ${phone ? `
                <tr>
                  <td style="padding: 6px 0; color: #6f7287;">Phone</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right;">${phone}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 6px 0; color: #6f7287;">Payment Channel</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right;">Paystack (Verified)</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #6f7287;">Transaction Ref</td>
                  <td style="padding: 6px 0; font-family: monospace; font-weight: 700; text-align: right; color: #39364f;">${reference}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #6f7287;">Order ID</td>
                  <td style="padding: 6px 0; font-family: monospace; font-size: 11px; text-align: right; color: #6f7287;">${orderId}</td>
                </tr>
              </table>
            </div>

            <!-- Items Table -->
            <h3 style="margin: 0 0 12px 0; color: #39364f; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
              Order Details
            </h3>

            <div style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; margin-bottom: 24px;">
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <thead style="background-color: #f8f7fa; border-bottom: 1px solid #e5e7eb; color: #6f7287;">
                  <tr>
                    <th style="padding: 10px 14px; text-align: left; font-weight: 600;">Event & Tier</th>
                    <th style="padding: 10px 14px; text-align: center; font-weight: 600;">Qty</th>
                    <th style="padding: 10px 14px; text-align: right; font-weight: 600;">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${items.length > 0 ? items.map(item => `
                    <tr style="border-bottom: 1px solid #f0f0f0;">
                      <td style="padding: 12px 14px; font-weight: 600; color: #39364f;">
                        ${eventName}
                        <div style="font-size: 12px; font-weight: 500; color: #d1410c;">${item.name || item.ticketName || 'General Admission'}</div>
                      </td>
                      <td style="padding: 12px 14px; text-align: center; color: #39364f;">${item.quantity}</td>
                      <td style="padding: 12px 14px; text-align: right; font-weight: 600; color: #39364f;">₦${(item.price * item.quantity).toLocaleString()}</td>
                    </tr>
                  `).join('') : `
                    <tr>
                      <td style="padding: 12px 14px; font-weight: 600; color: #39364f;">${eventName}</td>
                      <td style="padding: 12px 14px; text-align: center; color: #39364f;">1</td>
                      <td style="padding: 12px 14px; text-align: right; font-weight: 600; color: #39364f;">${formattedAmount}</td>
                    </tr>
                  `}
                  <tr style="background-color: #f8f7fa;">
                    <td colspan="2" style="padding: 12px 14px; font-weight: 700; color: #39364f; font-size: 14px;">Total Paid</td>
                    <td style="padding: 12px 14px; text-align: right; font-weight: 800; color: #d1410c; font-size: 16px;">${formattedAmount}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Next Steps Callout -->
            <div style="background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
              <p style="margin: 0; color: #0369a1; font-size: 13px; line-height: 1.5;">
                🎫 <strong>Your Digital Ticket:</strong> Your official scannable entry pass and downloadable PDF have also been dispatched to this email address in a separate message.
              </p>
            </div>

            <!-- Footer -->
            <p style="font-size: 12px; color: #9ca3af; text-align: center; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
              Need help with this order? Contact event support at ${gmailUser}.<br>
              © ${new Date().getFullYear()} SWYFT Technologies. All rights reserved.
            </p>
          </div>
        </div>
      `,
    };

    const info = await sendWithRetry(mailOptions);
    console.log(`✉️ Receipt email successfully sent to ${email} (Message ID: ${info.messageId})`);
    return info;
  } catch (error) {
    console.error('❌ Error sending order receipt email:', error);
    throw error;
  }
};

export interface SendTicketParams {
  email: string;
  name: string;
  eventName: string;
  ticketType: string;
  venue: string;
  date: string;
  verificationId: string;
  reference: string;
  phone?: string;
  university?: string;
}

/**
 * 2. TICKET PASS EMAIL WITH DOWNLOADABLE PDF ATTACHED (Sent Second)
 */
export const sendTicketPassEmail = async ({
  email,
  name,
  eventName,
  ticketType,
  venue,
  date,
  verificationId,
  reference,
  phone,
  university,
}: SendTicketParams) => {
  try {
    // 1. Generate QR Code image buffer (for inline rendering in HTML)
    const qrBuffer = await QRCode.toBuffer(verificationId, {
      width: 250,
      margin: 1,
      color: {
        dark: '#111827',
        light: '#ffffff',
      },
    });

    // 2. Generate downloadable PDF ticket pass buffer
    const pdfBuffer = await generateTicketPdf({
      eventName,
      ticketType,
      attendeeName: name,
      verificationId,
      reference,
      date,
      venue,
      university,
    });

    const textContent = `Hi ${name},\n\nHere is your official admission pass for ${eventName}.\n\nDate: ${date}\nVenue: ${venue} ${university ? `• ${university}` : ''}\nTicket Tier: ${ticketType}\nBooking Reference: ${reference}\nVerification Token: ${verificationId}\n\nPresent this verification token or your QR code (see attached printable PDF) at the gate for admission.\n\nThank you for choosing SWYFT!`;

    const mailOptions = {
      from: `"Swyft Tickets" <${gmailUser}>`,
      replyTo: `"Swyft Support" <${gmailUser}>`,
      to: email,
      subject: `Your Admission Ticket: ${eventName}`,
      text: textContent,
      headers: {
        'X-Auto-Response-Suppress': 'OOF, AutoReply',
      },
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff; box-shadow: 0 4px 14px rgba(40,44,53,0.08);">
          
          <!-- Header -->
          <div style="background-color: #d1410c; padding: 28px 24px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.02em; color: #ffffff;">SWYFT</h1>
            <p style="margin: 6px 0 0 0; font-size: 13px; color: #fff2ed; font-weight: 500;">Official Admission Pass & Ticket</p>
          </div>
          
          <!-- Content -->
          <div style="padding: 32px 24px;">
            <h2 style="margin-top: 0; color: #39364f; font-size: 20px; font-weight: 700;">Hi ${name},</h2>
            <p style="color: #6f7287; font-size: 14px; line-height: 1.5; margin-bottom: 24px;">
              Here is your official admission pass for <strong>${eventName}</strong>. A scannable PDF is attached to this email for your convenience.
            </p>
            
            <!-- Event Card Container -->
            <div style="background-color: #ffffff; border: 1.5px solid #e5e7eb; border-radius: 12px; overflow: hidden; margin-bottom: 28px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
              
              <!-- Ticket Upper Banner -->
              <div style="background-color: #f8f7fa; padding: 20px; border-bottom: 1px dashed #dddae3;">
                <p style="margin: 0 0 4px 0; color: #d1410c; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
                  ${date.toUpperCase()}
                </p>
                <h3 style="margin: 0 0 8px 0; color: #39364f; font-size: 18px; font-weight: 700; line-height: 1.3;">
                  ${eventName}
                </h3>
                <p style="margin: 0; color: #6f7287; font-size: 13px; font-weight: 500;">
                  📍 ${venue} ${university ? `• ${university}` : ''}
                </p>
              </div>

              <!-- Ticket Info Grid -->
              <div style="padding: 20px; border-bottom: 1px dashed #dddae3;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                  <tr>
                    <td style="padding: 4px 0; color: #6f7287; font-weight: 500;">Attendee:</td>
                    <td style="padding: 4px 0; font-weight: 700; color: #39364f; text-align: right;">${name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #6f7287; font-weight: 500;">Ticket Tier:</td>
                    <td style="padding: 4px 0; font-weight: 700; color: #d1410c; text-align: right;">${ticketType}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #6f7287; font-weight: 500;">Booking Reference:</td>
                    <td style="padding: 4px 0; font-family: monospace; font-weight: 600; color: #39364f; text-align: right;">${reference}</td>
                  </tr>
                </table>
              </div>

              <!-- QR Code Check-in Area -->
              <div style="padding: 24px; text-align: center; background-color: #ffffff;">
                <div style="display: inline-block; padding: 12px; border: 1px solid #e5e7eb; border-radius: 10px; background-color: #ffffff; margin-bottom: 14px;">
                  <img src="data:image/png;base64,${qrBuffer.toString('base64')}" alt="Admission QR Code" width="180" height="180" style="display: block; margin: 0 auto; border: 0;" />
                </div>
                
                <p style="margin: 0 0 4px 0; font-size: 11px; color: #6f7287; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
                  Verification Token
                </p>
                <code style="font-family: monospace; font-size: 16px; color: #d1410c; font-weight: 800; background-color: #fff9f6; padding: 6px 14px; border-radius: 6px; border: 1px solid #fecaca; display: inline-block; word-break: break-all;">
                  ${verificationId}
                </code>
                
                <p style="margin: 16px 0 0 0; font-size: 13px; color: #6f7287; line-height: 1.4;">
                  Present this QR code or provide the Verification Token to event staff at the gate for fast entry check-in.
                </p>
              </div>

            </div>

            <!-- PDF Attachment Callout -->
            <div style="background-color: #fff9f6; border: 1.5px solid #fed7aa; border-radius: 8px; padding: 16px; display: flex; align-items: center; gap: 12px;">
              <span style="font-size: 24px;">📎</span>
              <div>
                <strong style="color: #39364f; font-size: 13px; display: block;">Downloadable Ticket PDF Attached</strong>
                <span style="color: #6f7287; font-size: 12px;">
                  A scannable, print-ready PDF copy (<code>ticket-${verificationId}.pdf</code>) is attached to this email for offline scanning.
                </span>
              </div>
            </div>

            <!-- Footer -->
            <p style="font-size: 11px; color: #888888; text-align: center; margin-top: 28px; border-top: 1px solid #e5e7eb; padding-top: 16px; line-height: 1.5;">
              This is a transactional confirmation from Swyft Ticketing for your purchase.<br>
              Questions? Contact support at ${gmailUser}.<br>
              © ${new Date().getFullYear()} SWYFT Technologies. All rights reserved.
            </p>
          </div>
        </div>
      `,
      attachments: [
        {
          filename: `ticket-${verificationId}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    };

    const info = await sendWithRetry(mailOptions);
    console.log(`✉️ Ticket pass email with PDF attached sent to ${email} (Message ID: ${info.messageId})`);
    return info;
  } catch (error) {
    console.error('❌ Error sending ticket pass email:', error);
    throw error;
  }
};

export interface SendPasswordResetParams {
  email: string;
  name: string;
  resetCode: string;
}

/**
 * 3. PASSWORD RESET EMAIL WITH 6-DIGIT VERIFICATION CODE
 */
export const sendPasswordResetEmail = async ({
  email,
  name,
  resetCode,
}: SendPasswordResetParams) => {
  try {
    const textContent = `Hi ${name || 'there'},\n\nWe received a request to reset your password on Swyft. Use the 6-digit verification code below to reset your password:\n\n${resetCode}\n\nThis code will expire in 15 minutes. If you did not request this, you can safely ignore this email.\n\nBest regards,\nThe Swyft Team`;

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8f7fa; padding: 32px 16px; min-height: 100%;">
        <div style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <div style="background-color: #d1410c; padding: 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 0.5px;">SWYFT</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 6px 0 0 0; font-size: 14px;">Password Recovery</p>
          </div>

          <!-- Body -->
          <div style="padding: 32px 28px;">
            <h2 style="font-size: 20px; font-weight: 700; color: #39364f; margin: 0 0 12px 0;">Reset Your Password</h2>
            <p style="font-size: 14px; color: #6f7287; line-height: 1.6; margin: 0 0 24px 0;">
              Hello ${name ? `<strong>${name}</strong>` : 'there'}, we received a request to reset the password for your Swyft account (${email}).
            </p>

            <div style="background-color: #fff9f6; border: 1.5px dashed #d1410c; border-radius: 10px; padding: 20px; text-align: center; margin-bottom: 24px;">
              <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: 700; color: #6f7287; text-transform: uppercase; letter-spacing: 1px;">Your 6-Digit Verification Code</p>
              <span style="font-family: monospace; font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #d1410c; display: inline-block;">
                ${resetCode}
              </span>
              <p style="margin: 8px 0 0 0; font-size: 12px; color: #9ca3af;">Valid for 15 minutes</p>
            </div>

            <p style="font-size: 13px; color: #6f7287; line-height: 1.5; margin: 0 0 20px 0;">
              Enter this code on the password reset page to set a new password. If you did not make this request, you can safely ignore this email.
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0 16px 0;" />

            <!-- Footer -->
            <p style="font-size: 11px; color: #9ca3af; text-align: center; margin: 0; line-height: 1.5;">
              This email was sent to ${email} for password assistance.<br/>
              © ${new Date().getFullYear()} SWYFT Technologies. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    `;

    const mailOptions = {
      from: `"Swyft Security" <${gmailUser}>`,
      to: email,
      subject: `Your Swyft Password Reset Code: ${resetCode}`,
      text: textContent,
      html: htmlContent,
      priority: 'high',
      headers: {
        'X-Entity-Ref-ID': `pwd-reset-${Date.now()}`,
      },
    };

    const info = await sendWithRetry(mailOptions);
    console.log(`✉️ Password reset email sent to ${email} (Message ID: ${info.messageId})`);
    return info;
  } catch (error) {
    console.error('❌ Error sending password reset email:', error);
    throw error;
  }
};

/**
 * 4. WELCOME EMAIL (sent on onboarding or welcome request)
 */
export const sendWelcomeEmail = async (email: string, name?: string) => {
  try {
    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8f7fa; padding: 32px 16px; min-height: 100%;">
        <div style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 14px rgba(0,0,0,0.05); border: 1px solid #e5e7eb;">
          <div style="background: linear-gradient(135deg, #d1410c 0%, #ea580c 100%); padding: 32px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 900; letter-spacing: 0.5px;">SWYFT TICKETS</h1>
            <p style="color: rgba(255,255,255,0.92); margin: 6px 0 0 0; font-size: 14px;">Next-Gen Ticketing & Event Management</p>
          </div>
          <div style="padding: 32px 28px;">
            <h2 style="font-size: 20px; font-weight: 800; color: #1a202c; margin: 0 0 12px 0;">Welcome to Swyft Tickets! 🎉</h2>
            <p style="font-size: 15px; color: #4b5563; line-height: 1.6; margin: 0 0 20px 0;">
              Hello ${name ? `<strong>${name}</strong>` : 'there'}, welcome to <strong>Swyft Tickets</strong>!
            </p>
            <p style="font-size: 14px; color: #6f7287; line-height: 1.6; margin: 0 0 24px 0;">
              Your account and notification system are now set up. You can discover upcoming events, get fast QR ticket passes, and manage organizer sales directly from your dashboard.
            </p>
            <div style="background-color: #fff9f6; border: 1.5px solid #ffedd5; border-radius: 12px; padding: 18px; margin-bottom: 24px;">
              <p style="margin: 0; font-size: 13px; color: #c2410c; font-weight: 600;">
                ✓ Verified Email Notifications Active<br/>
                ✓ Instant QR Pass Delivery Enabled<br/>
                ✓ High-Deliverability Inbox Delivery
              </p>
            </div>
            <div style="text-align: center; margin: 28px 0;">
              <a href="https://swyft-mu.vercel.app" style="background-color: #d1410c; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; padding: 12px 28px; border-radius: 9999px; display: inline-block;">
                Visit Swyft Tickets
              </a>
            </div>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0 16px 0;" />
            <p style="font-size: 11px; color: #9ca3af; text-align: center; margin: 0; line-height: 1.5;">
              This email was sent to ${email} via Resend.<br/>
              © ${new Date().getFullYear()} SWYFT Technologies. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    `;

    const mailOptions = {
      from: resendFrom,
      to: email,
      subject: 'Welcome to swyft-tickets',
      text: `Hello ${name || 'there'},\n\nWelcome to Swyft Tickets! Your account and notification system are now active.\n\nVisit: https://swyft-mu.vercel.app\n\n© ${new Date().getFullYear()} SWYFT Technologies`,
      html: htmlContent,
    };

    const info = await sendWithRetry(mailOptions);
    console.log(`✉️ Welcome email sent to ${email} (Message ID: ${info.messageId})`);
    return info;
  } catch (error) {
    console.error('❌ Error sending welcome email:', error);
    throw error;
  }
};


