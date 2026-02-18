const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { generateSingleTicket } = require('../generate-pdf');
const { verifyWebhookSignature } = require('../ziina');

const router = express.Router();

// ── API Key middleware for n8n ──
function requireApiKey(req, res, next) {
  const apiKey = process.env.N8N_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });
  const provided = req.headers['x-api-key'];
  if (!provided || provided !== apiKey) return res.status(401).json({ error: 'Invalid API key' });
  next();
}

// Stats for live dashboard
router.get('/api/stats', requireAuth, async (req, res) => {
  const event = await db.getActiveEvent();
  if (!event) return res.json({ total: 0, checkedIn: 0 });
  const stats = await db.getStats(event.id);
  res.json(stats);
});

// Recent activity for live feed
router.get('/api/activity', requireAuth, async (req, res) => {
  const event = await db.getActiveEvent();
  if (!event) return res.json([]);
  const activity = await db.getRecentActivity(event.id, 30);
  res.json(activity);
});

// Check-in timeline for chart
router.get('/api/timeline', requireAuth, async (req, res) => {
  const event = await db.getActiveEvent();
  if (!event) return res.json([]);
  const timeline = await db.getCheckinTimeline(event.id);
  res.json(timeline);
});

// Guest search (JSON)
router.get('/api/guests', requireAuth, async (req, res) => {
  const event = await db.getActiveEvent();
  if (!event) return res.json([]);
  const search = req.query.search || '';
  const guests = search
    ? await db.searchGuests(search, event.id)
    : await db.getAllGuests(event.id);
  res.json(guests);
});

// Manual check-in via API
router.post('/api/checkin/:id', requireAuth, async (req, res) => {
  const guest = await db.getGuestById(Number(req.params.id));
  if (!guest) return res.status(404).json({ error: 'Guest not found' });

  if (guest.badge_active === false) {
    return res.status(403).json({ error: 'Badge has been deactivated. Please see an admin.' });
  }

  const event = await db.getActiveEvent();
  const user = req.session.user;

  if (guest.checked_in) {
    await db.incrementScanCount(guest.id);
    if (event) {
      await db.logActivity(event.id, 'duplicate_checkin_attempt', {
        guestId: guest.id,
        userId: user.id,
        details: `Duplicate check-in attempt for ${guest.name} by ${user.display_name}`,
      });
    }
    return res.json({ status: 'already', guest });
  }

  await db.checkInGuest(guest.id, user.id);
  const updatedGuest = await db.getGuestById(guest.id);

  if (event) {
    await db.logActivity(event.id, 'checkin', {
      guestId: guest.id,
      userId: user.id,
      details: `${guest.name} checked in by ${user.display_name}`,
    });

    if (req.app.locals.broadcast) {
      req.app.locals.broadcast({
        type: 'checkin',
        guest: { id: guest.id, name: guest.name, category: guest.category },
        user: { display_name: user.display_name },
        timestamp: new Date().toISOString(),
      });
    }
  }

  res.json({ status: 'success', guest: updatedGuest });
});

// Edit guest details
router.put('/api/guests/:id', requireAuth, async (req, res) => {
  const guest = await db.getGuestById(Number(req.params.id));
  if (!guest) return res.status(404).json({ error: 'Guest not found' });

  const user = req.session.user;
  if (user.role !== 'admin' && user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });

  const { name, category, dietary_restrictions, table_number, phone, email, family_size } = req.body;
  await db.updateGuest(guest.id, {
    name: name || guest.name,
    category: category || guest.category,
    dietary_restrictions: dietary_restrictions !== undefined ? dietary_restrictions : guest.dietary_restrictions,
    table_number: table_number !== undefined ? table_number : guest.table_number,
    phone: phone !== undefined ? phone : guest.phone,
    email: email !== undefined ? email : guest.email,
    family_size: family_size !== undefined ? family_size : guest.family_size,
  });

  const event = await db.getActiveEvent();
  if (event) {
    await db.logActivity(event.id, 'edit_guest', {
      guestId: guest.id,
      userId: user.id,
      details: `${user.display_name} edited guest: ${name || guest.name}`,
    });
  }

  const updated = await db.getGuestById(guest.id);
  res.json({ status: 'ok', guest: updated });
});

// Get single guest
router.get('/api/guests/:id', requireAuth, async (req, res) => {
  const guest = await db.getGuestById(Number(req.params.id));
  if (!guest) return res.status(404).json({ error: 'Guest not found' });
  res.json(guest);
});

// ── n8n: Get guests with email addresses ──
router.get('/api/guests-with-email', requireApiKey, async (req, res) => {
  const event = await db.getActiveEvent();
  if (!event) return res.json([]);
  const guests = await db.getAllGuests(event.id);
  const withEmail = guests.filter(g => g.email && g.email.trim());
  res.json(withEmail);
});

// ── n8n: Download single ticket PDF by guest ID ──
router.get('/api/ticket/:id', requireApiKey, async (req, res) => {
  const guest = await db.getGuestById(Number(req.params.id));
  if (!guest) return res.status(404).json({ error: 'Guest not found' });

  const event = await db.getActiveEvent();
  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="ticket-${guest.id}.pdf"`);
  await generateSingleTicket(guest, baseUrl, res, event);
});

// ── Offline sync: process queued check-ins ──
router.post('/api/sync-checkins', requireAuth, async (req, res) => {
  const { checkins } = req.body;
  if (!Array.isArray(checkins)) return res.status(400).json({ error: 'Invalid data' });

  const event = await db.getActiveEvent();
  const user = req.session.user;
  let synced = 0;

  for (const item of checkins) {
    const guest = await db.getGuestById(Number(item.guestId));
    if (!guest || guest.checked_in) continue;

    await db.checkInGuest(guest.id, user.id);
    synced++;

    if (event) {
      await db.logActivity(event.id, 'checkin', {
        guestId: guest.id,
        userId: user.id,
        details: `${guest.name} checked in by ${user.display_name} (offline sync)`,
      });

      if (req.app.locals.broadcast) {
        req.app.locals.broadcast({
          type: 'checkin',
          guest: { id: guest.id, name: guest.name, category: guest.category },
          user: { display_name: user.display_name },
          timestamp: item.timestamp || new Date().toISOString(),
        });
      }
    }
  }

  res.json({ status: 'ok', synced });
});

// ── n8n: Get checked-in guests with emails (for feedback) ──
router.get('/api/guests-checked-in', requireApiKey, async (req, res) => {
  const event = await db.getActiveEvent();
  if (!event) return res.json([]);
  const guests = await db.getAllGuests(event.id);
  const checkedInWithEmail = guests.filter(g => g.checked_in && g.email && g.email.trim());
  res.json(checkedInWithEmail);
});

// ── Payment Status Toggle ──
router.post('/api/guests/:id/paid', requireAuth, async (req, res) => {
  const user = req.session.user;
  if (user.role !== 'admin' && user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });

  const guest = await db.getGuestById(Number(req.params.id));
  if (!guest) return res.status(404).json({ error: 'Guest not found' });

  if (guest.paid) {
    await db.markGuestUnpaid(guest.id);
  } else {
    await db.markGuestPaid(guest.id);
  }

  const event = await db.getActiveEvent();
  if (event) {
    await db.logActivity(event.id, guest.paid ? 'mark_unpaid' : 'mark_paid', {
      guestId: guest.id,
      userId: user.id,
      details: `${user.display_name} marked ${guest.name} as ${guest.paid ? 'unpaid' : 'paid'}`,
    });
  }

  const updated = await db.getGuestById(guest.id);
  res.json({ status: 'ok', guest: updated });
});

// ── Badge Active Toggle ──
router.post('/api/guests/:id/badge-toggle', requireAuth, async (req, res) => {
  const user = req.session.user;
  if (user.role !== 'admin' && user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });

  const guest = await db.getGuestById(Number(req.params.id));
  if (!guest) return res.status(404).json({ error: 'Guest not found' });

  const newActive = !guest.badge_active;
  await db.setBadgeActive(guest.id, newActive);

  const event = await db.getActiveEvent();
  if (event) {
    await db.logActivity(event.id, newActive ? 'badge_activated' : 'badge_deactivated', {
      guestId: guest.id,
      userId: user.id,
      details: `${user.display_name} ${newActive ? 'activated' : 'deactivated'} badge for ${guest.name}`,
    });
  }

  const updated = await db.getGuestById(guest.id);
  res.json({ status: 'ok', guest: updated });
});

// ── n8n: Get paid guests with emails (for sending badges) ──
// Returns only paid guests who haven't received badges yet, then marks them as sent
router.get('/api/guests-paid', requireApiKey, async (req, res) => {
  const event = await db.getActiveEvent();
  if (!event) return res.json([]);
  const guests = await db.getPaidGuestsWithEmail(event.id);
  // Mark these guests as badge_sent so subsequent calls won't include them
  if (guests.length > 0) {
    await db.markBadgesSent(guests.map(g => g.id));
  }
  res.json(guests);
});

// ── Google Form Registration ──
// Called by n8n when a new Google Form response arrives
router.post('/api/register-from-form', requireApiKey, async (req, res) => {
  const event = await db.getActiveEvent();
  if (!event) return res.status(400).json({ error: 'No active event' });

  // Trim keys and values to handle whitespace from Google Sheets / n8n
  const body = {};
  for (const [k, v] of Object.entries(req.body)) {
    body[k.trim()] = typeof v === 'string' ? v.trim() : v;
  }
  const { email, name, grade, attendance, attendance_type, family_size, dietary, phone, volunteer, suggestions } = body;

  if (!name) return res.status(400).json({ error: 'Name is required' });

  // Skip guests who said "No" to attending
  if (attendance && attendance.toLowerCase() === 'no') {
    return res.json({ status: 'skipped', reason: 'Guest declined attendance' });
  }

  // Check for duplicate by email within this event
  if (email && email.trim()) {
    const existing = await db.getAllGuests(event.id);
    const duplicate = existing.find(g => g.email && g.email.toLowerCase() === email.trim().toLowerCase());
    if (duplicate) {
      return res.json({ status: 'duplicate', reason: 'Email already registered', guest: duplicate });
    }
  }

  // Determine category and family size
  let category = 'student';
  let size = 1;
  if (attendance_type && attendance_type.toLowerCase().includes('family')) {
    category = 'family';
    size = parseInt(family_size) || 2;
  }

  // Build notes from extra fields
  const notesParts = [];
  if (grade) notesParts.push(`Grade: ${grade}`);
  if (attendance && attendance.toLowerCase() === 'maybe') notesParts.push('Attendance: Maybe');
  if (volunteer && (volunteer === true || volunteer.toString().toLowerCase() === 'yes')) notesParts.push('Wants to volunteer');
  if (suggestions && suggestions.trim()) notesParts.push(`Suggestions: ${suggestions.trim()}`);

  const guest = await db.addSingleGuest(event.id, {
    name: name.trim(),
    category,
    dietary_restrictions: dietary || null,
    table_number: grade || null,
    phone: phone || null,
    email: email ? email.trim() : null,
    family_size: size,
  });

  // Store extra info in notes field
  if (notesParts.length > 0) {
    await db.pool.query('UPDATE guests SET notes = $1 WHERE id = $2', [notesParts.join(' | '), guest.id]);
  }

  await db.logActivity(event.id, 'form_registration', {
    guestId: guest.id,
    details: `${guest.name} registered via Google Form${grade ? ` (${grade})` : ''}`,
  });

  res.json({ status: 'created', guest });
});

// ── Ziina Payment Webhook ──
router.post('/api/webhook/ziina', async (req, res) => {
  const secret = process.env.ZIINA_WEBHOOK_SECRET;
  const signature = req.headers['x-hmac-signature'] || req.headers['x-webhook-signature'] || '';

  // Verify HMAC if secret is configured
  if (secret && signature) {
    const rawBody = JSON.stringify(req.body);
    if (!verifyWebhookSignature(rawBody, signature, secret)) {
      console.error('Ziina webhook: invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const payload = req.body;
  if (!payload) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const paymentIntentId = payload.id || (payload.data && payload.data.id);
  const status = payload.status || (payload.data && payload.data.status);

  if (!paymentIntentId) {
    return res.status(400).json({ error: 'Missing payment intent ID' });
  }

  console.log(`Ziina webhook: payment ${paymentIntentId} status=${status}`);

  if (status === 'completed') {
    const guest = await db.getGuestByPaymentIntent(paymentIntentId);
    if (!guest) {
      console.error(`Ziina webhook: no guest found for payment ${paymentIntentId}`);
      return res.json({ received: true });
    }

    if (!guest.paid) {
      await db.markGuestPaid(guest.id);

      const event = await db.getActiveEvent();
      if (event) {
        await db.logActivity(event.id, 'ziina_payment', {
          guestId: guest.id,
          details: `Payment confirmed via Ziina for ${guest.name}`,
        });
      }

      // Broadcast to dashboard
      if (req.app.locals.broadcast) {
        req.app.locals.broadcast({
          type: 'payment_confirmed',
          guest: { id: guest.id, name: guest.name, category: guest.category },
          timestamp: new Date().toISOString(),
        });
      }

      // Auto-trigger badge send via n8n and mark as sent
      const webhookUrl = process.env.N8N_WEBHOOK_URL;
      if (webhookUrl && guest.email) {
        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        try {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'send_badge_single',
              app_base_url: baseUrl,
              api_key: process.env.N8N_API_KEY,
              guest_id: guest.id,
              guest_name: guest.name,
              guest_email: guest.email,
              event: event ? { name: event.name, date: event.event_date, time: event.event_time, venue: event.venue } : null,
            }),
          });
          await db.markBadgesSent([guest.id]);
          console.log(`Auto-triggered badge email for ${guest.name}`);
        } catch (e) {
          console.error('Failed to trigger badge email:', e.message);
        }
      }
    }
  }

  res.json({ received: true });
});

// ── Announcements ──
router.post('/api/announcement', requireAuth, async (req, res) => {
  const user = req.session.user;

  const event = await db.getActiveEvent();
  if (!event) return res.status(400).json({ error: 'No active event' });

  const { message, type } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message required' });

  const announcement = await db.createAnnouncement(event.id, message.trim(), type, user.id);

  if (req.app.locals.broadcast) {
    req.app.locals.broadcast({
      type: 'announcement',
      announcement: { id: announcement.id, message: announcement.message, announcementType: announcement.type, created_by_name: user.display_name },
    });
  }

  await db.logActivity(event.id, 'announcement', {
    userId: user.id,
    details: `${user.display_name} broadcast: ${message.trim()}`,
  });

  res.json({ status: 'ok', announcement });
});

router.get('/api/announcement', requireAuth, async (req, res) => {
  const event = await db.getActiveEvent();
  if (!event) return res.json(null);
  const announcement = await db.getActiveAnnouncement(event.id);
  res.json(announcement);
});

router.post('/api/announcement/:id/dismiss', requireAuth, async (req, res) => {
  const user = req.session.user;
  if (user.role !== 'admin' && user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });

  await db.dismissAnnouncement(Number(req.params.id));

  if (req.app.locals.broadcast) {
    req.app.locals.broadcast({
      type: 'announcement_dismissed',
      announcementId: Number(req.params.id),
    });
  }

  res.json({ status: 'ok' });
});

module.exports = router;
