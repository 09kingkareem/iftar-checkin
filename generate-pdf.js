const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

// ══════════════════════════════════════════════════════════
// Event Badge: Portrait, 2 per A4 page
// Badge: 340pt x 400pt (4.72" x 5.56")
// ══════════════════════════════════════════════════════════

const BADGE_W = 340;
const BADGE_H = 400;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const BADGES_PER_PAGE = 2;
const BADGE_X = (PAGE_W - BADGE_W) / 2;
const GAP_Y = (PAGE_H - BADGE_H * BADGES_PER_PAGE) / (BADGES_PER_PAGE + 1);

// ── Color Palette ──
const C = {
  navy:       '#0B1A2E',
  navyMid:    '#10213B',
  navyLight:  '#162D4A',
  gold:       '#C9A84C',
  goldBright: '#E8C547',
  goldDark:   '#A68A3E',
  goldFaint:  'rgba(201,168,76,0.08)',
  white:      '#FFFFFF',
  cream:      '#F5ECD7',
  textLight:  '#D4CFC0',
  textMuted:  '#8A8575',
};

// ── Category Themes ──
const CATEGORIES = {
  vip:     { accent: '#C9A84C', bg: '#3D3418', label: 'VIP GUEST',  strip: '#C9A84C' },
  student: { accent: '#4A90D9', bg: '#152A4A', label: 'STUDENT',    strip: '#4A90D9' },
  parent:  { accent: '#5BAF6E', bg: '#1A3A22', label: 'PARENT',     strip: '#5BAF6E' },
  teacher: { accent: '#9B6DC6', bg: '#2A1D3E', label: 'TEACHER',    strip: '#9B6DC6' },
  guest:   { accent: '#8C9AA8', bg: '#1E2A36', label: 'GUEST',      strip: '#8C9AA8' },
};

function getCat(category) {
  return CATEGORIES[(category || 'guest').toLowerCase()] || CATEGORIES.guest;
}

// ══════════════════════════════════════════════════════════
// Multi-badge PDF: 2 per A4 page
// ══════════════════════════════════════════════════════════
async function generatePDF(guests, baseUrl, outputStream, event) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.pipe(outputStream);

  for (let i = 0; i < guests.length; i++) {
    if (i > 0 && i % BADGES_PER_PAGE === 0) doc.addPage();

    const slot = i % BADGES_PER_PAGE;
    const badgeY = GAP_Y + slot * (BADGE_H + GAP_Y);

    await drawBadge(doc, guests[i], baseUrl, event, BADGE_X, badgeY);
    drawCutMarks(doc, BADGE_X, badgeY, BADGE_W, BADGE_H);
  }

  doc.end();
}

// ══════════════════════════════════════════════════════════
// Single badge centered on A4
// ══════════════════════════════════════════════════════════
async function generateSingleTicket(guest, baseUrl, outputStream, event) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.pipe(outputStream);

  const badgeY = (PAGE_H - BADGE_H) / 2;
  await drawBadge(doc, guest, baseUrl, event, BADGE_X, badgeY);
  drawCutMarks(doc, BADGE_X, badgeY, BADGE_W, BADGE_H);

  doc.end();
}

// ══════════════════════════════════════════════════════════
// Badge Renderer — Portrait Event Badge
// ══════════════════════════════════════════════════════════
async function drawBadge(doc, guest, baseUrl, event, x, y) {
  const cat = getCat(guest.category);
  const pad = 24;
  const innerX = x + pad;
  const innerW = BADGE_W - pad * 2;
  const centerX = x + BADGE_W / 2;

  // ── Background ──
  doc.save();
  doc.roundedRect(x, y, BADGE_W, BADGE_H, 8).fill(C.navy);

  // Subtle radial-like gradient (lighter in center)
  const grad = doc.linearGradient(x, y, x, y + BADGE_H);
  grad.stop(0, C.navyMid).stop(0.4, C.navyLight).stop(1, C.navy);
  doc.roundedRect(x, y, BADGE_W, BADGE_H, 8).fill(grad);

  // ── Category accent strip at top (6pt with rounded top) ──
  doc.save();
  doc.roundedRect(x, y, BADGE_W, 10, 8).clip();
  doc.rect(x, y, BADGE_W, 6).fill(cat.strip);
  doc.restore();

  // ── Outer border (gold) ──
  doc.roundedRect(x + 1.5, y + 1.5, BADGE_W - 3, BADGE_H - 3, 7)
    .lineWidth(1.5).strokeColor(C.gold).stroke();

  // ── Inner border (faint gold) ──
  doc.roundedRect(x + 6, y + 6, BADGE_W - 12, BADGE_H - 12, 5)
    .lineWidth(0.4).strokeOpacity(0.2).strokeColor(C.gold).stroke();
  doc.strokeOpacity(1);

  // ── Corner ornaments ──
  drawCornerOrnaments(doc, x + 10, y + 10, BADGE_W - 20, BADGE_H - 20);

  // ════════════════════════════════════
  // TOP SECTION — Event branding
  // ════════════════════════════════════
  let curY = y + 22;

  // Crescent + star flanking event name
  drawCrescentMoon(doc, innerX + 6, curY + 8, 8);
  drawStar(doc, x + BADGE_W - pad - 6, curY + 6, 5);

  // Event name
  doc.font('Helvetica-Bold').fontSize(16).fillColor(C.gold);
  doc.text(event ? event.name : 'Iftar Dinner', innerX, curY, {
    width: innerW,
    align: 'center',
  });
  curY += 24;

  // Subtitle
  doc.font('Helvetica').fontSize(7.5).fillColor(C.textMuted);
  doc.text('You are cordially invited', innerX, curY, {
    width: innerW,
    align: 'center',
  });
  curY += 16;

  // ── Gold divider ──
  const divW = 120;
  doc.strokeColor(C.gold).lineWidth(0.7);
  doc.moveTo(centerX - divW / 2, curY).lineTo(centerX + divW / 2, curY).stroke();
  drawDiamond(doc, centerX, curY, 3);
  curY += 18;

  // ════════════════════════════════════
  // CENTER SECTION — Guest identity
  // ════════════════════════════════════

  // Guest name (large, prominent)
  doc.font('Helvetica-Bold').fontSize(22).fillColor(C.white);
  doc.text(guest.name, innerX, curY, {
    width: innerW,
    align: 'center',
    ellipsis: true,
    height: 32,
  });
  curY += 34;

  // Category badge (pill shape)
  const badgeLabel = cat.label;
  doc.font('Helvetica-Bold').fontSize(8);
  const badgeTextW = doc.widthOfString(badgeLabel) + 20;
  const badgeH = 18;
  const badgeX = centerX - badgeTextW / 2;

  doc.roundedRect(badgeX, curY, badgeTextW, badgeH, badgeH / 2).fill(cat.bg);
  doc.roundedRect(badgeX, curY, badgeTextW, badgeH, badgeH / 2)
    .lineWidth(0.8).strokeColor(cat.accent).stroke();
  doc.font('Helvetica-Bold').fontSize(8).fillColor(cat.accent);
  doc.text(badgeLabel, badgeX, curY + 4.5, { width: badgeTextW, align: 'center' });
  curY += badgeH + 14;

  // Table number (if exists)
  if (guest.table_number) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.goldBright);
    doc.text(`TABLE ${guest.table_number}`, innerX, curY, {
      width: innerW,
      align: 'center',
    });
    curY += 18;
  }

  // ── Thin divider ──
  curY += 4;
  doc.strokeColor(C.gold).lineWidth(0.3).strokeOpacity(0.3);
  doc.moveTo(innerX + 30, curY).lineTo(x + BADGE_W - pad - 30, curY).stroke();
  doc.strokeOpacity(1);
  curY += 12;

  // ════════════════════════════════════
  // BOTTOM SECTION — QR + event details
  // ════════════════════════════════════

  // QR code (centered)
  const qrSize = 80;
  const qrX = centerX - qrSize / 2;
  const qrY = curY;

  const url = `${baseUrl}/checkin/${guest.token}`;
  const qrDataUrl = await QRCode.toDataURL(url, {
    width: qrSize * 4,
    margin: 0,
    errorCorrectionLevel: 'M',
    color: { dark: '#0B1A2E', light: '#FFFFFF' },
  });
  const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');

  // White QR background
  doc.roundedRect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 8, 4).fill(C.white);
  doc.roundedRect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 8, 4)
    .lineWidth(0.4).strokeColor(C.goldDark).stroke();
  doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });

  curY = qrY + qrSize + 10;

  // "Scan to check in"
  doc.font('Helvetica').fontSize(6).fillColor(C.textMuted);
  doc.text('SCAN TO CHECK IN', innerX, curY, { width: innerW, align: 'center' });
  curY += 14;

  // Event details row
  const detailY = y + BADGE_H - 38;
  doc.font('Helvetica').fontSize(7).fillColor(C.textLight);

  const dateStr = event ? event.event_date : '';
  const timeStr = event ? event.event_time : '';
  const venueStr = event ? event.venue : '';
  const detailLine = [dateStr, timeStr, venueStr].filter(Boolean).join('  |  ');

  doc.text(detailLine, innerX, detailY, {
    width: innerW,
    align: 'center',
  });

  // ── Decorative stars bottom corners ──
  drawStar(doc, x + 18, y + BADGE_H - 18, 4);
  drawStar(doc, x + BADGE_W - 18, y + BADGE_H - 18, 4);
  drawStar(doc, x + 28, y + BADGE_H - 26, 2.5);
  drawStar(doc, x + BADGE_W - 28, y + BADGE_H - 26, 2.5);

  doc.restore();
}

// ══════════════════════════════════════════════════════════
// Decorative Drawing Functions
// ══════════════════════════════════════════════════════════

function drawCornerOrnaments(doc, x, y, w, h) {
  doc.save();
  const s = 12;
  doc.strokeColor(C.gold).lineWidth(0.7).opacity(0.45);
  doc.moveTo(x, y + s).lineTo(x, y).lineTo(x + s, y).stroke();
  doc.moveTo(x + w - s, y).lineTo(x + w, y).lineTo(x + w, y + s).stroke();
  doc.moveTo(x, y + h - s).lineTo(x, y + h).lineTo(x + s, y + h).stroke();
  doc.moveTo(x + w - s, y + h).lineTo(x + w, y + h).lineTo(x + w, y + h - s).stroke();
  doc.opacity(1);
  doc.restore();
}

function drawCrescentMoon(doc, cx, cy, r) {
  doc.save();
  doc.fillColor(C.gold).opacity(0.55);
  doc.circle(cx, cy, r).fill();
  doc.fillColor(C.navy);
  doc.circle(cx + r * 0.35, cy - r * 0.15, r * 0.78).fill();
  doc.opacity(1);
  doc.restore();
}

function drawStar(doc, cx, cy, r) {
  doc.save();
  doc.fillColor(C.gold).opacity(0.45);
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
  const len = 10;
  const gap = 4;
  doc.strokeColor('#AAAAAA').lineWidth(0.3);
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
