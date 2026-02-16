const express = require('express');
const db = require('../db');

const router = express.Router();

// Public QR check-in route
router.get('/checkin/:token', async (req, res) => {
  const guest = await db.getGuestByToken(req.params.token);
  const event = await db.getActiveEvent();
  const eventId = event ? event.id : null;

  if (!guest) {
    return res.send(renderCheckin({
      status: 'error',
      icon: '&#10060;',
      heading: 'Invalid QR Code',
      message: 'This QR code is not recognized. Please see a volunteer for help.',
    }));
  }

  if (guest.checked_in) {
    // Increment scan count for security tracking
    await db.incrementScanCount(guest.id);

    const checkedInBy = guest.checked_in_by
      ? (await db.getUserById(guest.checked_in_by))
      : null;
    const byName = checkedInBy ? checkedInBy.display_name : 'Unknown';
    const time = guest.checked_in_at
      ? new Date(guest.checked_in_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : 'earlier';

    if (eventId) {
      await db.logActivity(eventId, 'duplicate_scan', {
        guestId: guest.id,
        details: `Duplicate scan for ${guest.name} (scan #${guest.scan_count + 1})`,
      });

      // Broadcast duplicate alert via WebSocket (attached by server.js)
      if (req.app.locals.broadcast) {
        req.app.locals.broadcast({
          type: 'duplicate_scan',
          guest: { id: guest.id, name: guest.name, scan_count: guest.scan_count + 1 },
          timestamp: new Date().toISOString(),
        });
      }
    }

    return res.send(renderCheckin({
      status: 'already',
      icon: '&#9888;&#65039;',
      heading: 'Already Checked In',
      message: `${escapeHtml(guest.name)} was checked in at ${time} by ${escapeHtml(byName)}.`,
      subtitle: `Scan count: ${guest.scan_count + 1}`,
    }));
  }

  // Check in the guest (kiosk/public scan — no specific user)
  await db.checkInGuest(guest.id, null);
  const updatedGuest = await db.getGuestById(guest.id);

  if (eventId) {
    await db.logActivity(eventId, 'checkin', {
      guestId: guest.id,
      details: `${guest.name} checked in via QR scan`,
    });

    if (req.app.locals.broadcast) {
      req.app.locals.broadcast({
        type: 'checkin',
        guest: { id: guest.id, name: guest.name, category: guest.category, family_size: guest.family_size },
        timestamp: new Date().toISOString(),
      });
    }
  }

  const isFamily = guest.category === 'family' && guest.family_size > 1;
  const checkinMsg = isFamily
    ? `All ${guest.family_size} family members are checked in. Enjoy the iftar!`
    : "You're checked in. Enjoy the iftar!";

  res.send(renderCheckin({
    status: 'success',
    icon: '&#9989;',
    heading: `Welcome, ${escapeHtml(guest.name)}!`,
    message: checkinMsg,
    subtitle: guest.table_number ? `Table: ${escapeHtml(guest.table_number)}` : '',
  }));
});

function renderCheckin({ status, icon, heading, message, subtitle = '' }) {
  const subtitleHtml = subtitle ? `<p class="checkin-subtitle">${subtitle}</p>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iftar Check-in</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="checkin-page">
    <div class="checkin-card ${status}">
      <div class="checkin-icon">${icon}</div>
      <h1>${heading}</h1>
      <p>${message}</p>
      ${subtitleHtml}
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = router;
