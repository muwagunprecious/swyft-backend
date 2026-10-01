import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import QRCode from 'qrcode';
import dns from 'dns';
import { generateTicketPdf } from './pdf.service';

// Enforce IPv4 first to prevent ISP IPv6 routing timeouts to smtp.gmail.com
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {
  // Ignore on older node versions if unsupported
}

dotenv.config();

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
  lookup: (hostname: string, options: any, callback?: any) => {
    const cb = typeof options === 'function' ? options : callback;
    dns.lookup(hostname, { family: 4 }, cb);
  },
} as any);

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

    const mailOptions = {
      from: `"SWYFT Receipts" <${gmailUser}>`,
      to: email,
      subject: `Order Confirmed: ${eventName} [${reference}]`,
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

    const info = await transporter.sendMail(mailOptions);
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

    const mailOptions = {
      from: `"SWYFT Tickets" <${gmailUser}>`,
      to: email,
      subject: `Your Admission Ticket: ${eventName}`,
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
                  <img src="cid:ticketqrcode" alt="Admission QR Code" width="180" height="180" style="display: block; margin: 0 auto;" />
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
            <p style="font-size: 12px; color: #9ca3af; text-align: center; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
              Questions about this ticket? Contact event support at ${gmailUser}.<br>
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
        {
          filename: 'qrcode.png',
          content: qrBuffer,
          cid: 'ticketqrcode', // Inline embedded image
        },
      ],
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✉️ Ticket pass email with PDF attached sent to ${email} (Message ID: ${info.messageId})`);
    return info;
  } catch (error) {
    console.error('❌ Error sending ticket pass email:', error);
    throw error;
  }
};
