import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export interface TicketPdfData {
  eventName: string;
  ticketType: string;
  attendeeName: string;
  verificationId: string;
  reference: string;
  date: string;
  venue: string;
  university?: string;
}

export async function generateTicketPdf(data: TicketPdfData): Promise<Buffer> {
  const qrBuffer = await QRCode.toBuffer(data.verificationId, {
    width: 200,
    margin: 1,
    color: {
      dark: '#111827',
      light: '#ffffff',
    },
  });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [380, 580], // Compact, modern ticket card dimensions
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      info: {
        Title: `${data.eventName} Admission Pass`,
        Author: 'Swyft Tickets',
        Subject: 'Event Ticket Pass',
        Creator: 'Swyft Ticketing Platform',
        Producer: 'Swyft Engine',
      },
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', (err) => reject(err));

    // Top Brand Accent Header
    doc
      .rect(0, 0, 380, 80)
      .fill('#d1410c');

    doc
      .fontSize(22)
      .font('Helvetica-Bold')
      .fillColor('#ffffff')
      .text('SWYFT', 30, 24, { characterSpacing: 1.5 });

    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#ffe7dd')
      .text('OFFICIAL ADMISSION PASS', 30, 50, { characterSpacing: 1 });

    // Main Card Body Background
    doc
      .rect(0, 80, 380, 500)
      .fill('#ffffff');

    // Event Title
    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .fillColor('#39364f')
      .text(data.eventName, 30, 105, { width: 320 });

    // Date & Venue Details
    const detailsY = doc.y + 8;
    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .fillColor('#d1410c')
      .text(data.date.toUpperCase(), 30, detailsY);

    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#6f7287')
      .text(`${data.venue}${data.university ? ` • ${data.university}` : ''}`, 30, doc.y + 4, { width: 320 });

    // Divider Line
    const dividerY = doc.y + 14;
    doc
      .strokeColor('#e5e7eb')
      .lineWidth(1)
      .moveTo(30, dividerY)
      .lineTo(350, dividerY)
      .stroke();

    // Attendee Info
    const infoY = dividerY + 14;
    doc
      .fontSize(8)
      .font('Helvetica-Bold')
      .fillColor('#6f7287')
      .text('ATTENDEE', 30, infoY);

    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#39364f')
      .text(data.attendeeName, 30, infoY + 12);

    doc
      .fontSize(8)
      .font('Helvetica-Bold')
      .fillColor('#6f7287')
      .text('TICKET TIER', 220, infoY);

    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#d1410c')
      .text(data.ticketType, 220, infoY + 12);

    // QR Code Container Box
    const qrBoxY = infoY + 40;
    doc
      .roundedRect(30, qrBoxY, 320, 210, 10)
      .fillAndStroke('#f8f7fa', '#e5e7eb');

    // Embed QR Code Image
    doc.image(qrBuffer, 115, qrBoxY + 15, { width: 150, height: 150 });

    // Verification ID
    doc
      .fontSize(9)
      .font('Courier-Bold')
      .fillColor('#d1410c')
      .text(data.verificationId, 40, qrBoxY + 175, { align: 'center', width: 300 });

    doc
      .fontSize(8)
      .font('Helvetica')
      .fillColor('#6f7287')
      .text('SCAN AT GATE FOR ADMISSION', 40, qrBoxY + 190, { align: 'center', width: 300 });

    // Footer
    doc
      .fontSize(7)
      .font('Helvetica')
      .fillColor('#9ca3af')
      .text(`Booking Ref: ${data.reference} • Non-transferable admission token.`, 30, 550, { align: 'center', width: 320 });

    doc.end();
  });
}
