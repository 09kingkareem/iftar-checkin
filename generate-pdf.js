const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

// ── Colors ──
const DARK_GREEN = '#0B3D2E';
const NAVY = '#0a1628';
const GOLD = '#D4AF37';
const GOLD_LIGHT = '#F0D060';
const WHITE = '#FFFFFF';
const CREAM = '#FFF8E7';

// ── Ticket Layout: 2 per A4 page (half-page each) ──
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const TICKET_H = PAGE_H / 2;
const MARGIN = 30;

async function generatePDF(guests, baseUrl, outputStream, event) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.pipe(outputStream);

  for (let i = 0; i < guests.length; i++) {
    if (i > 0 && i % 2 === 0) doc.addPage();
    const slot = i % 2; // 0 = top half, 1 = bottom half
    const yOffset = slot * TICKET_H;
    await drawTicket(doc, guests[i], baseUrl, event, yOffset);

    // Dashed cut line between tickets
    if (slot === 0) {
      doc.save();
      doc.strokeColor('#666666').lineWidth(0.5).dash(5, { space: 5 });
      doc.moveTo(MARGIN, TICKET_H).lineTo(PAGE_W - MARGIN, TICKET_H).stroke();
      doc.restore();
    }
  }

  doc.end();
}

async function generateSingleTicket(guest, baseUrl, outputStream, event) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.pipe(outputStream);
  await drawTicket(doc, guest, baseUrl, event, 0);
  doc.end();
}

async function drawTicket(doc, guest, baseUrl, event, yOffset) {
  const x = 0;
  const y = yOffset;
  const w = PAGE_W;
  const h = TICKET_H;

  // ── Background ──
  doc.save();
  doc.rect(x, y, w, h).fill(NAVY);

  // Subtle gradient overlay (dark green at bottom)
  const grad = doc.linearGradient(x, y, x, y + h);
  grad.stop(0, NAVY, 0.9).stop(1, DARK_GREEN, 0.9);
  doc.rect(x, y, w, h).fill(grad);

  // ── Geometric Border ──
  drawGeometricBorder(doc, x + MARGIN - 10, y + MARGIN - 10, w - 2 * (MARGIN - 10), h - 2 * (MARGIN - 10));

  // ── Decorative Elements ──
  drawCrescentMoon(doc, x + 70, y + 60, 25);
  drawStar(doc, x + w - 80, y + 60, 12);
  drawStar(doc, x + w - 110, y + 75, 8);
  drawStar(doc, x + 110, y + 50, 8);
  drawLantern(doc, x + w - 60, y + h - 100, 15);
  drawLantern(doc, x + 50, y + h - 100, 15);

  // ── Corner Stars ──
  drawStar(doc, x + MARGIN + 5, y + MARGIN + 5, 6);
  drawStar(doc, x + w - MARGIN - 5, y + MARGIN + 5, 6);
  drawStar(doc, x + MARGIN + 5, y + h - MARGIN - 5, 6);
  drawStar(doc, x + w - MARGIN - 5, y + h - MARGIN - 5, 6);

  // ── Header: Event Title ──
  const titleY = y + MARGIN + 30;
  doc.font('Helvetica-Bold').fontSize(22).fillColor(GOLD);
  doc.text(event ? event.name : 'School Iftar', x + MARGIN, titleY, {
    width: w - 2 * MARGIN,
    align: 'center',
  });

  // ── Subtitle: Invitation ──
  doc.font('Helvetica').fontSize(11).fillColor(CREAM);
  doc.text('You are cordially invited', x + MARGIN, titleY + 32, {
    width: w - 2 * MARGIN,
    align: 'center',
  });

  // ── Gold divider ──
  const divY = titleY + 55;
  doc.strokeColor(GOLD).lineWidth(1);
  doc.moveTo(x + w / 2 - 80, divY).lineTo(x + w / 2 + 80, divY).stroke();
  drawDiamond(doc, x + w / 2, divY, 4);

  // ── Guest Name ──
  const nameY = divY + 18;
  doc.font('Helvetica-Bold').fontSize(26).fillColor(WHITE);
  doc.text(guest.name, x + MARGIN, nameY, {
    width: w - 2 * MARGIN,
    align: 'center',
  });

  // ── Category Badge ──
  const catY = nameY + 36;
  const category = (guest.category || 'guest').toUpperCase();
  const catColor = getCategoryColor(guest.category);
  doc.roundedRect(x + w / 2 - 40, catY, 80, 20, 10).fill(catColor);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(WHITE);
  doc.text(category, x + w / 2 - 40, catY + 5, { width: 80, align: 'center' });

  // ── Event Details Row ──
  const detailY = catY + 35;
  doc.font('Helvetica').fontSize(10).fillColor(GOLD_LIGHT);

  const dateText = event ? event.event_date : '';
  const timeText = event ? event.event_time : '';
  const venueText = event ? event.venue : '';

  doc.text(`Date: ${dateText}`, x + MARGIN + 20, detailY, { width: 160 });
  doc.text(`Time: ${timeText}`, x + MARGIN + 180, detailY, { width: 160 });
  doc.text(`Venue: ${venueText}`, x + MARGIN + 340, detailY, { width: 180 });

  if (guest.table_number) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(GOLD);
    doc.text(`Table: ${guest.table_number}`, x + MARGIN + 20, detailY + 18, { width: 200 });
  }

  // ── QR Code ──
  const qrSize = 110;
  const qrX = x + w / 2 - qrSize / 2;
  const qrY = detailY + 40;

  const url = `${baseUrl}/checkin/${guest.token}`;
  const qrDataUrl = await QRCode.toDataURL(url, {
    width: qrSize * 3,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#FFFFFF' },
  });
  const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');

  // White background for QR
  doc.roundedRect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 12, 6).fill(WHITE);
  doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });

  // ── Footer text under QR ──
  doc.font('Helvetica').fontSize(8).fillColor(CREAM);
  doc.text('Scan QR code at the door to check in', x + MARGIN, qrY + qrSize + 14, {
    width: w - 2 * MARGIN,
    align: 'center',
  });

  doc.restore();
}

// ── Decorative Drawing Functions ──

function drawGeometricBorder(doc, x, y, w, h) {
  doc.save();
  doc.strokeColor(GOLD).lineWidth(1.5);
  doc.roundedRect(x, y, w, h, 8).stroke();

  // Inner border
  doc.strokeColor(GOLD).lineWidth(0.5).opacity(0.4);
  doc.roundedRect(x + 5, y + 5, w - 10, h - 10, 6).stroke();
  doc.opacity(1);

  // Corner decorations
  const cornerSize = 15;
  [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(([cx, cy]) => {
    doc.strokeColor(GOLD).lineWidth(1).opacity(0.6);
    // L-shaped corner accents
    const dx = cx === x ? 1 : -1;
    const dy = cy === y ? 1 : -1;
    doc.moveTo(cx, cy + dy * cornerSize).lineTo(cx, cy).lineTo(cx + dx * cornerSize, cy).stroke();
  });

  doc.opacity(1);
  doc.restore();
}

function drawCrescentMoon(doc, cx, cy, r) {
  doc.save();
  doc.fillColor(GOLD).opacity(0.7);

  // Outer circle
  doc.circle(cx, cy, r).fill();
  // Inner cutout (slightly offset)
  doc.fillColor(NAVY);
  doc.circle(cx + r * 0.35, cy - r * 0.15, r * 0.8).fill();

  doc.opacity(1);
  doc.restore();
}

function drawStar(doc, cx, cy, r) {
  doc.save();
  doc.fillColor(GOLD).opacity(0.6);

  const points = [];
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 2) + (i * Math.PI / 5);
    const radius = i % 2 === 0 ? r : r * 0.4;
    points.push([
      cx + Math.cos(angle) * radius,
      cy - Math.sin(angle) * radius,
    ]);
  }

  doc.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    doc.lineTo(points[i][0], points[i][1]);
  }
  doc.closePath().fill();

  doc.opacity(1);
  doc.restore();
}

function drawDiamond(doc, cx, cy, size) {
  doc.save();
  doc.fillColor(GOLD);
  doc.moveTo(cx, cy - size)
    .lineTo(cx + size, cy)
    .lineTo(cx, cy + size)
    .lineTo(cx - size, cy)
    .closePath().fill();
  doc.restore();
}

function drawLantern(doc, cx, cy, size) {
  doc.save();
  doc.fillColor(GOLD).opacity(0.4);

  // Top cap
  doc.ellipse(cx, cy - size, size * 0.4, size * 0.15).fill();

  // Body
  doc.moveTo(cx - size * 0.35, cy - size * 0.8)
    .bezierCurveTo(cx - size * 0.6, cy, cx - size * 0.6, cy + size * 0.5, cx - size * 0.2, cy + size)
    .lineTo(cx + size * 0.2, cy + size)
    .bezierCurveTo(cx + size * 0.6, cy + size * 0.5, cx + size * 0.6, cy, cx + size * 0.35, cy - size * 0.8)
    .closePath().fill();

  // Hanging line
  doc.strokeColor(GOLD).lineWidth(0.5).opacity(0.5);
  doc.moveTo(cx, cy - size * 1.3).lineTo(cx, cy - size).stroke();

  doc.opacity(1);
  doc.restore();
}

function getCategoryColor(category) {
  const colors = {
    student: '#2980b9',
    parent: '#27ae60',
    teacher: '#8e44ad',
    vip: '#d4af37',
    guest: '#7f8c8d',
  };
  return colors[category] || colors.guest;
}

module.exports = { generatePDF, generateSingleTicket };
