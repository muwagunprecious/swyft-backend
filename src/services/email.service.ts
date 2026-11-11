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
const gmailPass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');

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
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden; background-color: #ffffff; box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
          
          <!-- Top Brand Header -->
          <div style="background-color: #0a0a0a; padding: 32px 24px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 28px; font-weight: 300; letter-spacing: 0.05em; color: #fafafa;">SWYFT</h1>
            <p style="margin: 6px 0 0 0; font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.1em;">Official Transaction Receipt</p>
          </div>
          
          <!-- Main Content -->
          <div style="padding: 32px 24px;">
            <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; padding: 18px 20px; border-radius: 12px; margin-bottom: 24px;">
              <h2 style="margin: 0 0 6px 0; color: #111827; font-size: 18px; font-weight: 600;">Order Confirmed</h2>
              <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 1.5;">
                Your order is confirmed. Your admission ticket passes and transaction invoice are detailed below.
              </p>
            </div>

            <!-- Receipt Breakdown -->
            <h3 style="margin: 0 0 12px 0; color: #374151; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;">
              Transaction Summary
            </h3>
            
            <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px; margin-bottom: 24px;">
              <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #374151;">
                <tr>
                  <td style="padding: 6px 0; color: #6b7280;">Order Date</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #111827;">${purchaseDate}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #6b7280;">Billed To</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #111827;">${name}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #6b7280;">Email Address</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #111827;">${email}</td>
                </tr>
                ${phone ? `
                <tr>
                  <td style="padding: 6px 0; color: #6b7280;">Phone</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #111827;">${phone}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 6px 0; color: #6b7280;">Payment Method</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #10b981;">Paystack (Verified)</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #6b7280;">Reference</td>
                  <td style="padding: 6px 0; font-family: monospace; font-weight: 700; text-align: right; color: #111827;">${reference}</td>
                </tr>
              </table>
            </div>

            <!-- Items Table -->
            <h3 style="margin: 0 0 12px 0; color: #374151; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;">
              Order Details
            </h3>

            <div style="border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; margin-bottom: 24px;">
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <thead style="background-color: #f9fafb; border-bottom: 1px solid #e5e7eb; color: #6b7280;">
                  <tr>
                    <th style="padding: 10px 14px; text-align: left; font-weight: 600;">Event & Tier</th>
                    <th style="padding: 10px 14px; text-align: center; font-weight: 600;">Qty</th>
                    <th style="padding: 10px 14px; text-align: right; font-weight: 600;">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${items.length > 0 ? items.map(item => `
                    <tr style="border-bottom: 1px solid #f3f4f6;">
                      <td style="padding: 12px 14px; font-weight: 600; color: #111827;">
                        ${eventName}
                        <div style="font-size: 12px; font-weight: 400; color: #6b7280;">${item.name || item.ticketName || 'General Admission'}</div>
                      </td>
                      <td style="padding: 12px 14px; text-align: center; color: #374151;">${item.quantity}</td>
                      <td style="padding: 12px 14px; text-align: right; font-weight: 600; color: #111827;">₦${(item.price * item.quantity).toLocaleString()}</td>
                    </tr>
                  `).join('') : `
                    <tr>
                      <td style="padding: 12px 14px; font-weight: 600; color: #111827;">${eventName}</td>
                      <td style="padding: 12px 14px; text-align: center; color: #374151;">1</td>
                      <td style="padding: 12px 14px; text-align: right; font-weight: 600; color: #111827;">${formattedAmount}</td>
                    </tr>
                  `}
                  <tr style="background-color: #f9fafb;">
                    <td colspan="2" style="padding: 12px 14px; font-weight: 600; color: #111827; font-size: 14px;">Total Paid</td>
                    <td style="padding: 12px 14px; text-align: right; font-weight: 700; color: #111827; font-size: 16px;">${formattedAmount}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Next Steps Callout -->
            <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
              <p style="margin: 0; color: #166534; font-size: 13px; line-height: 1.5;">
                🎫 <strong>Digital Pass Dispatched:</strong> Your scannable gate pass and downloadable PDF have also been sent to your email.
              </p>
            </div>

            <!-- Footer -->
            <p style="font-size: 11px; color: #9ca3af; text-align: center; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
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
  bannerImage?: string;
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
  bannerImage,
}: SendTicketParams) => {
  try {
    // 1. Generate QR Code image buffer pointing to verification page on swyft-ticket.name.ng
    const qrTargetUrl = `https://swyft-ticket.name.ng/verify?code=${encodeURIComponent(verificationId)}`;
    const qrBuffer = await QRCode.toBuffer(qrTargetUrl, {
      width: 320,
      margin: 1,
      color: {
        dark: '#0a0a0a',
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

    // 3. Setup inline attachments (QR code + PDF + optional banner)
    const attachments: any[] = [
      {
        filename: 'ticket-qr.png',
        content: qrBuffer,
        cid: 'ticket-qr-code',
        contentType: 'image/png',
        contentDisposition: 'inline',
      },
      {
        filename: `ticket-${verificationId}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ];

    let bannerSrc: string | null = null;
    if (bannerImage) {
      if (bannerImage.startsWith('data:image/')) {
        const matches = bannerImage.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches) {
          const mimeType = matches[1];
          const ext = mimeType.split('/')[1] || 'jpg';
          const imageBuffer = Buffer.from(matches[2], 'base64');
          attachments.push({
            filename: `event-banner.${ext}`,
            content: imageBuffer,
            cid: 'event-banner-image',
            contentType: mimeType,
            contentDisposition: 'inline',
          });
          bannerSrc = 'cid:event-banner-image';
        }
      } else if (bannerImage.startsWith('http://') || bannerImage.startsWith('https://')) {
        bannerSrc = bannerImage;
      } else if (bannerImage.startsWith('/')) {
        bannerSrc = `https://swyft-ticket.name.ng${bannerImage}`;
      }
    }

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
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${eventName} Admission Pass</title>
        </head>
        <body style="margin: 0; padding: 24px 12px; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #fafafa; -webkit-font-smoothing: antialiased;">
          
          <!-- Outer Card Container -->
          <div style="max-width: 580px; margin: 0 auto; background-color: #121212; border: 1px solid #262626; border-radius: 20px; overflow: hidden; box-shadow: 0 16px 48px rgba(0,0,0,0.7);">
            
            <!-- Top Brand Bar -->
            <div style="background-color: #0d0d0d; padding: 20px 24px; border-bottom: 1px solid #222222;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="vertical-align: middle;">
                    <div style="display: inline-flex; align-items: center;">
                      <span style="font-size: 22px; font-weight: 900; letter-spacing: 0.04em; color: #ffffff;">SWYFT</span>
                      <span style="background-color: #d1410c; color: #ffffff; padding: 3px 8px; border-radius: 6px; font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; margin-left: 8px;">TICKETS</span>
                    </div>
                  </td>
                  <td style="text-align: right; vertical-align: middle;">
                    <span style="color: #9ca3af; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em;">Official Pass</span>
                  </td>
                </tr>
              </table>
            </div>

            <!-- Event Banner Image -->
            ${bannerSrc ? `
              <div style="width: 100%; max-height: 240px; overflow: hidden; background-color: #171717; text-align: center; border-bottom: 1px solid #262626;">
                <img src="${bannerSrc}" alt="${eventName}" style="width: 100%; max-height: 240px; object-fit: cover; display: block; border: 0;" />
              </div>
            ` : `
              <div style="width: 100%; height: 6px; background-color: #d1410c;"></div>
            `}

            <!-- Body Padding Area -->
            <div style="padding: 28px 24px 20px 24px;">
              
              <!-- Greeting -->
              <h2 style="margin: 0 0 8px 0; color: #ffffff; font-size: 19px; font-weight: 700;">Hi ${name},</h2>
              <p style="margin: 0 0 24px 0; color: #9ca3af; font-size: 13px; line-height: 1.6;">
                Here is your official digital admission pass for <strong style="color: #fafafa;">${eventName}</strong>. Present the scannable QR pass below at the gate for fast check-in.
              </p>

              <!-- Digital Ticket Card (Swyft Dark UI) -->
              <div style="background-color: #171717; border: 1px solid #2e2e2e; border-radius: 18px; overflow: hidden; margin-bottom: 24px;">
                
                <!-- Ticket Upper Section -->
                <div style="padding: 22px 24px; background-color: #1b1b1b; border-bottom: 1px dashed #333333;">
                  
                  <div style="margin-bottom: 10px;">
                    <span style="display: inline-block; background-color: rgba(209,65,12,0.18); border: 1px solid rgba(209,65,12,0.45); color: #fb923c; padding: 4px 12px; border-radius: 9999px; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;">
                      🎟️ ${ticketType}
                    </span>
                  </div>

                  <h1 style="margin: 0 0 12px 0; color: #ffffff; font-size: 22px; font-weight: 800; line-height: 1.3;">
                    ${eventName}
                  </h1>

                  <div style="font-size: 13px; line-height: 1.5;">
                    <p style="margin: 0 0 4px 0; color: #fb923c; font-weight: 700;">
                      📅 ${date}
                    </p>
                    <p style="margin: 0; color: #9ca3af;">
                      📍 ${venue}${university ? ` • ${university}` : ''}
                    </p>
                  </div>
                </div>

                <!-- Ticket Details Key-Value Grid -->
                <div style="padding: 18px 24px; border-bottom: 1px dashed #333333; background-color: #171717;">
                  <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <tr>
                      <td style="padding: 6px 0; color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Attendee</td>
                      <td style="padding: 6px 0; color: #fafafa; font-weight: 700; text-align: right;">${name}</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 0; color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Ticket Tier</td>
                      <td style="padding: 6px 0; color: #fb923c; font-weight: 700; text-align: right;">${ticketType}</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 0; color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Booking Reference</td>
                      <td style="padding: 6px 0; font-family: monospace; color: #34d399; font-weight: 700; text-align: right; letter-spacing: 0.05em;">${reference}</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 0; color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Gate Admission</td>
                      <td style="padding: 6px 0; color: #10b981; font-weight: 700; text-align: right;">● Ready for Entry</td>
                    </tr>
                  </table>
                </div>

                <!-- QR Code Admission Pass Area -->
                <div style="padding: 26px 24px; text-align: center; background-color: #171717;">
                  
                  <p style="margin: 0 0 14px 0; font-size: 11px; color: #9ca3af; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em;">
                    Official Gate Scan Pass
                  </p>

                  <!-- White QR Card Container -->
                  <div style="display: inline-block; padding: 14px; background-color: #ffffff; border-radius: 18px; box-shadow: 0 8px 30px rgba(0,0,0,0.5); margin-bottom: 18px;">
                    <a href="${qrTargetUrl}" target="_blank" style="text-decoration: none; display: block;" title="Click or scan to verify ticket pass">
                      <img src="cid:ticket-qr-code" alt="Scan Ticket QR Pass" width="200" height="200" style="display: block; margin: 0 auto; border: 0; width: 200px; height: 200px;" />
                    </a>
                  </div>

                  <!-- Verification Token Monospace Badge -->
                  <div style="margin-bottom: 14px;">
                    <p style="margin: 0 0 6px 0; font-size: 10px; color: #9ca3af; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;">
                      Verification Token
                    </p>
                    <div style="display: inline-block; background-color: #0d0d0d; border: 1px solid #333333; border-radius: 10px; padding: 8px 20px;">
                      <code style="font-family: monospace; font-size: 15px; color: #f97316; font-weight: 800; letter-spacing: 0.08em;">
                        ${verificationId}
                      </code>
                    </div>
                  </div>

                  <p style="margin: 0 auto 20px auto; font-size: 12px; color: #9ca3af; line-height: 1.5; max-width: 380px;">
                    Present this QR pass on your mobile device at the entrance. The organizer will scan it to verify and admit you instantly.
                  </p>

                  <div>
                    <a href="${qrTargetUrl}" target="_blank" style="display: inline-block; background-color: #d1410c; color: #ffffff; padding: 13px 32px; border-radius: 12px; font-size: 13px; font-weight: 800; text-decoration: none; letter-spacing: 0.02em; box-shadow: 0 4px 16px rgba(209,65,12,0.4);">
                      Open Digital Pass Online →
                    </a>
                  </div>

                </div>

              </div>

              <!-- PDF Attachment Notice Box -->
              <div style="background-color: #171717; border: 1px solid #2e2e2e; border-radius: 14px; padding: 16px 20px; margin-bottom: 24px;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="width: 36px; vertical-align: middle; font-size: 22px;">📎</td>
                    <td style="vertical-align: middle;">
                      <strong style="color: #fafafa; font-size: 13px; display: block; margin-bottom: 2px;">Print-Ready Ticket PDF Attached</strong>
                      <span style="color: #9ca3af; font-size: 12px;">A high-resolution PDF pass (<code style="color: #fb923c; font-family: monospace;">ticket-${verificationId}.pdf</code>) is attached for offline access or printing.</span>
                    </td>
                  </tr>
                </table>
              </div>

              <!-- Footer -->
              <div style="border-top: 1px solid #222222; padding-top: 20px; text-align: center;">
                <p style="margin: 0 0 6px 0; font-size: 12px; font-weight: 600; color: #71717a;">SWYFT Ticketing Platform</p>
                <p style="margin: 0; font-size: 11px; color: #52525b; line-height: 1.5;">
                  Need help? Contact support at <a href="mailto:${gmailUser}" style="color: #d1410c; text-decoration: none;">${gmailUser}</a>.<br>
                  © ${new Date().getFullYear()} SWYFT Technologies. All rights reserved.
                </p>
              </div>

            </div>

          </div>
        </body>
        </html>
      `,
      attachments,
    };

    const info = await sendWithRetry(mailOptions);
    console.log(`✉️ Ticket pass email with banner & CID QR sent to ${email} (Message ID: ${info.messageId})`);
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

export interface OrganizerTicketSaleParams {
  organizerEmail: string;
  organizerName: string;
  eventTitle: string;
  buyerName: string;
  buyerEmail?: string;
  buyerPhone?: string;
  ticketName: string;
  quantity: number;
  pricePaid: number;
  totalOrderPrice?: number;
  orderReference: string;
  orderId?: string;
  purchaseDate?: string;
}

/**
 * 5. ORGANIZER TICKET SALE NOTIFICATION EMAIL
 * Triggered immediately when a ticket is purchased so the organizer knows
 * a ticket was sold, who bought it, and the exact price paid.
 */
export const sendOrganizerTicketSaleNotification = async ({
  organizerEmail,
  organizerName,
  eventTitle,
  buyerName,
  buyerEmail,
  buyerPhone,
  ticketName,
  quantity,
  pricePaid,
  totalOrderPrice,
  orderReference,
  orderId,
  purchaseDate = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }),
}: OrganizerTicketSaleParams) => {
  try {
    const formattedPrice = `₦${(pricePaid ?? 0).toLocaleString()}`;
    const cleanOrgName = organizerName || 'Organizer';
    const cleanBuyerName = buyerName || 'Guest Attendee';

    const textContent = `Great news, ${cleanOrgName}!\n\nA ticket has just been sold for your event: "${eventTitle}".\n\nBuyer: ${cleanBuyerName}\n${buyerEmail ? `Email: ${buyerEmail}\n` : ''}${buyerPhone ? `Phone: ${buyerPhone}\n` : ''}Ticket: ${quantity}x ${ticketName}\nAmount Paid: ${formattedPrice}\nOrder Reference: ${orderReference}\nDate: ${purchaseDate}\n\nLog in to your Swyft organizer dashboard to view your updated ticket sales and wallet balance.`;

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden; background-color: #ffffff; box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
        
        <!-- Top Brand Header -->
        <div style="background-color: #0a0a0a; padding: 28px 24px; text-align: center; color: #ffffff;">
          <h1 style="margin: 0; font-size: 26px; font-weight: 800; letter-spacing: 0.05em; color: #fafafa;">SWYFT</h1>
          <p style="margin: 4px 0 0 0; font-size: 11px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.12em;">Ticket Sale Notification</p>
        </div>

        <!-- Hero Notification Banner -->
        <div style="padding: 32px 24px 20px 24px;">
          <div style="background: linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%); border: 1.5px solid #a7f3d0; padding: 20px 22px; border-radius: 14px; margin-bottom: 24px;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
              <span style="font-size: 24px;">🎉</span>
              <h2 style="margin: 0; color: #065f46; font-size: 19px; font-weight: 800;">
                You Just Sold a Ticket!
              </h2>
            </div>
            <p style="margin: 0; color: #047857; font-size: 13px; line-height: 1.5;">
              Hello <strong>${cleanOrgName}</strong>, a new attendee has just completed payment for your event <strong>"${eventTitle}"</strong>.
            </p>
          </div>

          <!-- Highlight Amount Card -->
          <div style="background-color: #fafafa; border: 1px solid #e5e7eb; border-radius: 14px; padding: 20px; text-align: center; margin-bottom: 24px;">
            <p style="margin: 0 0 4px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; color: #6b7280;">Amount Paid</p>
            <h3 style="margin: 0; font-size: 32px; font-weight: 900; color: #059669; letter-spacing: -0.02em;">
              ${formattedPrice}
            </h3>
            <p style="margin: 6px 0 0 0; font-size: 12px; font-weight: 600; color: #374151;">
              ${quantity}x ${ticketName}
            </p>
          </div>

          <!-- Attendee & Transaction Breakdown -->
          <h3 style="margin: 0 0 12px 0; color: #111827; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;">
            Buyer & Ticket Details
          </h3>
          
          <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px; margin-bottom: 24px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #374151;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Event</td>
                <td style="padding: 8px 0; font-weight: 700; text-align: right; color: #111827; border-bottom: 1px solid #f3f4f6;">${eventTitle}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Buyer Name</td>
                <td style="padding: 8px 0; font-weight: 700; text-align: right; color: #111827; border-bottom: 1px solid #f3f4f6;">${cleanBuyerName}</td>
              </tr>
              ${buyerEmail ? `
              <tr>
                <td style="padding: 8px 0; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Buyer Email</td>
                <td style="padding: 8px 0; font-family: monospace; font-size: 12px; text-align: right; color: #374151; border-bottom: 1px solid #f3f4f6;">${buyerEmail}</td>
              </tr>
              ` : ''}
              ${buyerPhone ? `
              <tr>
                <td style="padding: 8px 0; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Buyer Phone</td>
                <td style="padding: 8px 0; font-family: monospace; font-size: 12px; text-align: right; color: #374151; border-bottom: 1px solid #f3f4f6;">${buyerPhone}</td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 8px 0; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Ticket Tier</td>
                <td style="padding: 8px 0; font-weight: 600; text-align: right; color: #111827; border-bottom: 1px solid #f3f4f6;">${ticketName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Quantity</td>
                <td style="padding: 8px 0; font-weight: 600; text-align: right; color: #111827; border-bottom: 1px solid #f3f4f6;">${quantity}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Total Paid</td>
                <td style="padding: 8px 0; font-weight: 800; text-align: right; color: #059669; border-bottom: 1px solid #f3f4f6;">${formattedPrice}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Payment Reference</td>
                <td style="padding: 8px 0; font-family: monospace; font-size: 11px; font-weight: 700; text-align: right; color: #111827; border-bottom: 1px solid #f3f4f6;">${orderReference}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Purchase Date</td>
                <td style="padding: 8px 0; font-weight: 500; text-align: right; color: #4b5563;">${purchaseDate}</td>
              </tr>
            </table>
          </div>

          <!-- Quick Action Button -->
          <div style="text-align: center; margin: 28px 0;">
            <a href="https://swyft-mu.vercel.app/organizer" style="background-color: #0a0a0a; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 700; padding: 13px 32px; border-radius: 9999px; display: inline-block; letter-spacing: 0.02em;">
              View Organizer Dashboard & Wallet →
            </a>
          </div>

          <!-- Footer Note -->
          <p style="font-size: 11px; color: #9ca3af; text-align: center; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 16px; line-height: 1.5;">
            This email was sent to ${organizerEmail} because you host <strong>${eventTitle}</strong> on Swyft Tickets.<br/>
            © ${new Date().getFullYear()} SWYFT Technologies. All rights reserved.
          </p>
        </div>
      </div>
    `;

    const mailOptions = {
      from: `"Swyft Tickets" <${gmailUser}>`,
      replyTo: `"Swyft Support" <${gmailUser}>`,
      to: organizerEmail,
      subject: `🎟️ Ticket Sold! ₦${(pricePaid ?? 0).toLocaleString()} for ${eventTitle} (${cleanBuyerName})`,
      text: textContent,
      html: htmlContent,
      headers: {
        'X-Auto-Response-Suppress': 'OOF, AutoReply',
      },
    };

    const info = await sendWithRetry(mailOptions);
    console.log(`✉️ Organizer ticket sale notification sent to ${organizerEmail} (Message ID: ${info.messageId})`);
    return info;
  } catch (error) {
    console.error(`❌ Error sending organizer ticket sale notification to ${organizerEmail}:`, error);
    throw error;
  }
};



