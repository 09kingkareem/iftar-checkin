const PDFDocument = require('pdfkit');

const C = {
  navy: '#0B1A2E',
  gold: '#C9A84C',
  goldBright: '#E8C547',
  white: '#FFFFFF',
  text: '#D4CFC0',
  muted: '#8A8575',
  green: '#2ecc71',
  red: '#e74c3c',
};

async function generateReport(event, guests, outputStream) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(outputStream);

  const total = guests.length;
  const checkedIn = guests.filter(g => g.checked_in);
  const noShows = guests.filter(g => !g.checked_in);
  const totalPeople = guests.reduce((s, g) => s + (g.family_size || 1), 0);
  const checkedInPeople = checkedIn.reduce((s, g) => s + (g.family_size || 1), 0);
  const attendanceRate = totalPeople > 0 ? Math.round((checkedInPeople / totalPeople) * 100) : 0;

  // ── Title ──
  doc.font('Helvetica-Bold').fontSize(22).fillColor(C.gold)
    .text(event.name || 'Iftar Event', { align: 'center' });
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(12).fillColor(C.muted)
    .text('Post-Event Report', { align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor(C.muted)
    .text(`${event.event_date || ''} at ${event.event_time || ''} — ${event.venue || ''}`, { align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(9).fillColor(C.muted)
    .text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
  doc.moveDown(1.5);

  // ── Section 1: Summary ──
  drawSectionHeader(doc, 'Attendance Summary');

  const summaryData = [
    ['Total Registered (guests)', String(total)],
    ['Total People (incl. families)', String(totalPeople)],
    ['Checked In (people)', String(checkedInPeople)],
    ['No-Shows (people)', String(totalPeople - checkedInPeople)],
    ['Attendance Rate', attendanceRate + '%'],
  ];

  summaryData.forEach(([label, value]) => {
    doc.font('Helvetica').fontSize(11).fillColor('#333333');
    doc.text(label, 70, doc.y, { continued: true, width: 300 });
    doc.font('Helvetica-Bold').fillColor(C.gold).text('  ' + value);
  });

  doc.moveDown(1.5);

  // ── Section 2: Category Breakdown ──
  drawSectionHeader(doc, 'Category Breakdown');

  const categories = {};
  guests.forEach(g => {
    const cat = g.category || 'guest';
    if (!categories[cat]) categories[cat] = { total: 0, checkedIn: 0 };
    categories[cat].total++;
    if (g.checked_in) categories[cat].checkedIn++;
  });

  // Table header
  const tableX = 70;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.muted);
  doc.text('Category', tableX, doc.y, { continued: false });
  const headerY = doc.y - 12;
  doc.text('Registered', tableX + 150, headerY);
  doc.text('Checked In', tableX + 240, headerY);
  doc.text('Rate', tableX + 340, headerY);

  doc.moveTo(tableX, doc.y + 2).lineTo(tableX + 400, doc.y + 2).strokeColor('#cccccc').lineWidth(0.5).stroke();
  doc.moveDown(0.5);

  Object.entries(categories).sort((a, b) => b[1].total - a[1].total).forEach(([cat, data]) => {
    const rate = data.total > 0 ? Math.round((data.checkedIn / data.total) * 100) : 0;
    const rowY = doc.y;
    doc.font('Helvetica').fontSize(10).fillColor('#333333');
    doc.text(cat.charAt(0).toUpperCase() + cat.slice(1), tableX, rowY);
    doc.text(String(data.total), tableX + 150, rowY);
    doc.text(String(data.checkedIn), tableX + 240, rowY);
    doc.text(rate + '%', tableX + 340, rowY);
    doc.moveDown(0.2);
  });

  doc.moveDown(1.5);

  // ── Section 3: Timeline ──
  drawSectionHeader(doc, 'Check-in Timeline');

  const checkinTimes = checkedIn
    .filter(g => g.checked_in_at)
    .map(g => new Date(g.checked_in_at))
    .sort((a, b) => a - b);

  if (checkinTimes.length > 0) {
    const first = checkinTimes[0];
    const last = checkinTimes[checkinTimes.length - 1];

    // Find peak time (bucket by 5-min intervals)
    const buckets = {};
    checkinTimes.forEach(t => {
      const key = t.getHours() + ':' + String(Math.floor(t.getMinutes() / 5) * 5).padStart(2, '0');
      buckets[key] = (buckets[key] || 0) + 1;
    });
    const peakKey = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0];

    const timelineData = [
      ['First Check-in', first.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })],
      ['Last Check-in', last.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })],
      ['Peak Arrival Time', peakKey ? `${peakKey[0]} (${peakKey[1]} guests)` : 'N/A'],
      ['Duration', `${Math.round((last - first) / 60000)} minutes`],
    ];

    timelineData.forEach(([label, value]) => {
      doc.font('Helvetica').fontSize(11).fillColor('#333333');
      doc.text(label, 70, doc.y, { continued: true, width: 300 });
      doc.font('Helvetica-Bold').fillColor(C.gold).text('  ' + value);
    });
  } else {
    doc.font('Helvetica').fontSize(11).fillColor(C.muted).text('No check-in data available.', 70);
  }

  doc.moveDown(1.5);

  // ── Section 4: No-Shows ──
  if (noShows.length > 0) {
    if (doc.y > 650) doc.addPage();
    drawSectionHeader(doc, `No-Shows (${noShows.length})`);

    noShows.forEach((g, i) => {
      if (doc.y > 750) doc.addPage();
      doc.font('Helvetica').fontSize(10).fillColor('#333333');
      doc.text(`${i + 1}. ${g.name}`, 70, doc.y, { continued: true });
      doc.font('Helvetica').fontSize(9).fillColor(C.muted)
        .text(`  (${g.category || 'guest'}${g.table_number ? ', Table ' + g.table_number : ''})`);
    });
  }

  doc.end();
}

function drawSectionHeader(doc, title) {
  doc.font('Helvetica-Bold').fontSize(14).fillColor(C.gold).text(title, 50);
  doc.moveDown(0.3);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(C.gold).lineWidth(1).stroke();
  doc.moveDown(0.6);
}

module.exports = { generateReport };
