const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

// ══════════════════════════════════════════════════════════
// Card dimensions: 5.5" x 3.5" landscape (396 x 252 pts)
// Layout: 1 column, 3 rows per A4 page = 3 cards/page
// ══════════════════════════════════════════════════════════

const CARD_W = 396;   // 5.5 inches
const CARD_H = 252;   // 3.5 inches
const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const CARDS_PER_PAGE = 3;
const CARD_X = (PAGE_W - CARD_W) / 2; // centered horizontally
const PAGE_PAD_Y = (PAGE_H - CARD_H * CARDS_PER_PAGE) / (CARDS_PER_PAGE + 1); // even vertical spacing

// ── Color Palette ──
const C = {
  navy:      '#0B1A2E',
  navyLight: '#122240',
  gold:      '#C9A84C',
  goldBright:'#E8C547',
  goldDark:  '#A68A3E',
  white:     '#FFFFFF',
  cream:     '#F5ECD7',
  textLight: '#D4CFC0',
  textMuted: '#8A8575',
};

// ── Category Theme: accent color + label ──
const CATEGORIES = {
  vip:     { accent: '#C9A84C', bg: '#3D3418', label: 'VIP GUEST' },
  student: { accent: '#4A90D9', bg: '#152A4A', label: 'STUDENT' },
  parent:  { accent: '#5BAF6E', bg: '#1A3A22', label: 'PARENT' },
  teacher: { accent: '#9B6DC6', bg: '#2A1D3E', label: 'TEACHER' },
  guest:   { accent: '#8C9AA8', bg: '#1E2A36', label: 'GUEST' },
};

function getCat(category) {
  return CATEGORIES[(category || 'guest').toLowerCase()] || CATEGORIES.guest;
}

// ══════════════════════════════════════════════════════════
// Multi-guest PDF: 3 cards per A4 page
// ══════════════════════════════════════════════════════════
async function generatePDF(guests, baseUrl, outputStream, event) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.pipe(outputStream);

  for (let i = 0; i < guests.length; i++) {
    if (i > 0 && i % CARDS_PER_PAGE === 0) doc.addPage();

    const slot = i % CARDS_PER_PAGE;
    const cardY = PAGE_PAD_Y + slot * (CARD_H + PAGE_PAD_Y);

    await drawCard(doc, guests[i], baseUrl, event, CARD_X, cardY);

    // Cut guides (light gray corner marks)
    drawCutMarks(doc, CARD_X, cardY, CARD_W, CARD_H);
  }

  doc.end();
}

// ══════════════════════════════════════════════════════════
// Single ticket: one card centered on A4
// ══════════════════════════════════════════════════════════
async function generateSingleTicket(guest, baseUrl, outputStream, event) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.pipe(outputStream);

  const cardY = (PAGE_H - CARD_H) / 2;
  await drawCard(doc, guest, baseUrl, event, CARD_X, cardY);
  drawCutMarks(doc, CARD_X, cardY, CARD_W, CARD_H);

  doc.end();
}

// ══════════════════════════════════════════════════════════
// Core card renderer
// ══════════════════════════════════════════════════════════
async function drawCard(doc, guest, baseUrl, event, x, y) {
  const cat = getCat(guest.category);
  const pad = 16;

  // ── 1. Background ──
  doc.save();
  doc.roundedRect(x, y, CARD_W, CARD_H, 6).fill(C.navy);

  // Subtle gradient overlay
  const grad = doc.linearGradient(x, y, x + CARD_W, y + CARD_H);
  grad.stop(0, C.navy).stop(1, C.navyLight);
  doc.roundedRect(x, y, CARD_W, CARD_H, 6).fill(grad);

  // ── 2. Category accent strip (top, 4pt) ──
  doc.save();
  doc.roundedRect(x, y, CARD_W, 6, 6).clip();
  doc.rect(x, y, CARD_W, 4).fill(cat.accent);
  doc.restore();

  // ── 3. Double gold border ──
  doc.roundedRect(x + 1, y + 1, CARD_W - 2, CARD_H - 2, 6).lineWidth(1.2).strokeColor(C.gold).stroke();
  doc.roundedRect(x + 5, y + 5, CARD_W - 10, CARD_H - 10, 4).lineWidth(0.4).strokeOpacity(0.3).strokeColor(C.gold).stroke();
  doc.strokeOpacity(1);

  // ── 4. Corner ornaments ──
  drawCornerOrnaments(doc, x + 8, y + 8, CARD_W - 16, CARD_H - 16);

  // ── 5. Layout: Left (QR section) | Right (info section) ──
  const dividerX = x + 138; // left panel width
  const qrSection = { x: x + pad, y: y + 14, w: 138 - pad * 2 };
  const infoSection = { x: dividerX + 14, y: y + 14, w: CARD_W - 138 - 14 - pad };

  // Vertical divider line
  doc.save();
  doc.strokeColor(C.gold).lineWidth(0.5).opacity(0.25);
  doc.moveTo(dividerX, y + 20).lineTo(dividerX, y + CARD_H - 20).stroke();
  doc.opacity(1);
  doc.restore();

  // ────────────────────────────
  // LEFT PANEL: QR + scan text
  // ────────────────────────────
  const qrSize = 90;
  const qrX = qrSection.x + (qrSection.w - qrSize) / 2;
  const qrY = qrSection.y + 20;

  const url = `${baseUrl}/checkin/${guest.token}`;
  const qrDataUrl = await QRCode.toDataURL(url, {
    width: qrSize * 4,
    margin: 0,
    errorCorrectionLevel: 'M',
    color: { dark: '#0B1A2E', light: '#FFFFFF' },
  });
  const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');

  // QR white background with subtle gold border
  doc.roundedRect(qrX - 5, qrY - 5, qrSize + 10, qrSize + 10, 4).fill(C.white);
  doc.roundedRect(qrX - 5, qrY - 5, qrSize + 10, qrSize + 10, 4).lineWidth(0.5).strokeColor(C.goldDark).stroke();
  doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });

  // "Scan to check in" text
  doc.font('Helvetica').fontSize(6.5).fillColor(C.textMuted);
  doc.text('SCAN TO CHECK IN', qrSection.x, qrY + qrSize + 14, {
    width: qrSection.w,
    align: 'center',
  });

  // Small crescent + star icon centered below
  const iconCx = qrSection.x + qrSection.w / 2;
  const iconCy = qrY + qrSize + 32;
  drawCrescentMoon(doc, iconCx - 8, iconCy, 7);
  drawStar(doc, iconCx + 8, iconCy - 2, 4);

  // Table number at bottom of left panel (if exists)
  if (guest.table_number) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.gold);
    doc.text(`TABLE ${guest.table_number}`, qrSection.x, y + CARD_H - 32, {
      width: qrSection.w,
      align: 'center',
    });
  }

  // ─────────────────────────────
  // RIGHT PANEL: event + guest info
  // ─────────────────────────────
  const ri = infoSection;
  let curY = ri.y + 8;

  // Event name
  doc.font('Helvetica-Bold').fontSize(14).fillColor(C.gold);
  doc.text(event ? event.name : 'Iftar Dinner', ri.x, curY, { width: ri.w });
  curY += 20;

  // "You are cordially invited" subtitle
  doc.font('Helvetica').fontSize(7.5).fillColor(C.textMuted);
  doc.text('You are cordially invited to join us for iftar', ri.x, curY, { width: ri.w });
  curY += 16;

  // Gold divider with diamond
  doc.strokeColor(C.gold).lineWidth(0.6);
  doc.moveTo(ri.x, curY).lineTo(ri.x + ri.w, curY).stroke();
  drawDiamond(doc, ri.x + ri.w / 2, curY, 3);
  curY += 12;

  // Guest name (prominent)
  doc.font('Helvetica-Bold').fontSize(17).fillColor(C.white);
  doc.text(guest.name, ri.x, curY, { width: ri.w, ellipsis: true });
  curY += 24;

  // Category badge
  const badgeW = doc.widthOfString(cat.label, { font: 'Helvetica-Bold', size: 7 }) + 16;
  doc.roundedRect(ri.x, curY, badgeW, 16, 8).fill(cat.bg);
  doc.roundedRect(ri.x, curY, badgeW, 16, 8).lineWidth(0.5).strokeColor(cat.accent).stroke();
  doc.font('Helvetica-Bold').fontSize(7).fillColor(cat.accent);
  doc.text(cat.label, ri.x, curY + 4, { width: badgeW, align: 'center' });
  curY += 28;

  // Event details grid (icons replaced with labels)
  const detailFontSize = 7.5;
  const detailGap = 12;

  doc.font('Helvetica-Bold').fontSize(6).fillColor(C.textMuted);
  doc.text('DATE', ri.x, curY, { width: 80 });
  doc.text('TIME', ri.x + 95, curY, { width: 80 });
  curY += 9;

  doc.font('Helvetica').fontSize(detailFontSize).fillColor(C.cream);
  doc.text(event ? event.event_date : '', ri.x, curY, { width: 90 });
  doc.text(event ? event.event_time : '', ri.x + 95, curY, { width: 80 });
  curY += detailGap + 2;

  doc.font('Helvetica-Bold').fontSize(6).fillColor(C.textMuted);
  doc.text('VENUE', ri.x, curY, { width: 200 });
  curY += 9;

  doc.font('Helvetica').fontSize(detailFontSize).fillColor(C.cream);
  doc.text(event ? event.venue : '', ri.x, curY, { width: ri.w });

  // ── Bottom-right: small decorative stars ──
  drawStar(doc, x + CARD_W - 22, y + CARD_H - 22, 5);
  drawStar(doc, x + CARD_W - 36, y + CARD_H - 16, 3);

  doc.restore();
}

// ══════════════════════════════════════════════════════════
// Decorative Drawing Functions
// ══════════════════════════════════════════════════════════

function drawCornerOrnaments(doc, x, y, w, h) {
  doc.save();
  const s = 10;
  doc.strokeColor(C.gold).lineWidth(0.8).opacity(0.5);

  // Top-left
  doc.moveTo(x, y + s).lineTo(x, y).lineTo(x + s, y).stroke();
  // Top-right
  doc.moveTo(x + w - s, y).lineTo(x + w, y).lineTo(x + w, y + s).stroke();
  // Bottom-left
  doc.moveTo(x, y + h - s).lineTo(x, y + h).lineTo(x + s, y + h).stroke();
  // Bottom-right
  doc.moveTo(x + w - s, y + h).lineTo(x + w, y + h).lineTo(x + w, y + h - s).stroke();

  doc.opacity(1);
  doc.restore();
}

function drawCrescentMoon(doc, cx, cy, r) {
  doc.save();
  doc.fillColor(C.gold).opacity(0.6);
  doc.circle(cx, cy, r).fill();
  doc.fillColor(C.navy);
  doc.circle(cx + r * 0.35, cy - r * 0.15, r * 0.78).fill();
  doc.opacity(1);
  doc.restore();
}

function drawStar(doc, cx, cy, r) {
  doc.save();
  doc.fillColor(C.gold).opacity(0.5);

  const pts = [];
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI / 5);
    const rad = i % 2 === 0 ? r : r * 0.4;
    pts.push([cx + Math.cos(angle) * rad, cy + Math.sin(angle) * rad]);
  }

  doc.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) doc.lineTo(pts[i][0], pts[i][1]);
  doc.closePath().fill();

  doc.opacity(1);
  doc.restore();
}

function drawDiamond(doc, cx, cy, s) {
  doc.save();
  doc.fillColor(C.gold);
  doc.moveTo(cx, cy - s).lineTo(cx + s, cy).lineTo(cx, cy + s).lineTo(cx - s, cy).closePath().fill();
  doc.restore();
}

function drawCutMarks(doc, x, y, w, h) {
  doc.save();
  const len = 8;
  const gap = 3;
  doc.strokeColor('#BBBBBB').lineWidth(0.3);

  // Top-left
  doc.moveTo(x - gap - len, y).lineTo(x - gap, y).stroke();
  doc.moveTo(x, y - gap - len).lineTo(x, y - gap).stroke();
  // Top-right
  doc.moveTo(x + w + gap, y).lineTo(x + w + gap + len, y).stroke();
  doc.moveTo(x + w, y - gap - len).lineTo(x + w, y - gap).stroke();
  // Bottom-left
  doc.moveTo(x - gap - len, y + h).lineTo(x - gap, y + h).stroke();
  doc.moveTo(x, y + h + gap).lineTo(x, y + h + gap + len).stroke();
  // Bottom-right
  doc.moveTo(x + w + gap, y + h).lineTo(x + w + gap + len, y + h).stroke();
  doc.moveTo(x + w, y + h + gap).lineTo(x + w, y + h + gap + len).stroke();

  doc.restore();
}

module.exports = { generatePDF, generateSingleTicket };
