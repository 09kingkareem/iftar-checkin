const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

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
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const { name, category, dietary_restrictions, table_number, phone, email } = req.body;
  await db.updateGuest(guest.id, {
    name: name || guest.name,
    category: category || guest.category,
    dietary_restrictions: dietary_restrictions !== undefined ? dietary_restrictions : guest.dietary_restrictions,
    table_number: table_number !== undefined ? table_number : guest.table_number,
    phone: phone !== undefined ? phone : guest.phone,
    email: email !== undefined ? email : guest.email,
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

module.exports = router;
