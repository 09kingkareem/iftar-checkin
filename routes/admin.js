const express = require('express');
const multer = require('multer');
const bcrypt = require('bcrypt');
const db = require('../db');
const { requireAuth, requireAdmin, requireSuperAdmin, isAdmin, isSuperAdmin } = require('../middleware/auth');
const { generatePDF, generateSingleTicket } = require('../generate-pdf');
const { generateReport } = require('../generate-report');
const { t } = require('../i18n');
const ziina = require('../ziina');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Inline SVG crescent moon (no star) — Ramadan themed
const MOON_SVG = (size = 24, color = '#d4af37') => `<svg width="${size}" height="${size}" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;display:inline-block"><path d="M70 10C50.2 10 33.4 23.4 28.2 42 23 60.6 29.8 80.4 46 90.8 30 88 16 76.4 11.4 60.4 5.4 39.6 15.4 17.6 36.2 11.6 41.4 10 46.8 9.4 52 10 58 10.8 64 13 70 10Z" fill="${color}"/></svg>`;

const CATEGORY_COLORS = {
  student: '#3498db',
  parent: '#2ecc71',
  teacher: '#9b59b6',
  vip: '#f39c12',
  guest: '#95a5a6',
  family: '#e67e22',
};

// ── Dashboard ──
router.get('/admin', requireAuth, async (req, res) => {
  const event = await db.getActiveEvent();
  if (!event) return res.send('No active event found.');
  const user = req.session.user;
  const lang = res.locals.lang || 'en';
  const dir = res.locals.dir || 'ltr';

  res.send(renderDashboard(event, user, lang, dir));
});

// ── Import Guests ──
router.post('/admin/import', requireAdmin, upload.single('csv'), async (req, res) => {
  const event = await db.getActiveEvent();
  if (!event) return res.redirect('/admin');
  const user = req.session.user;

  if (req.file) {
    const content = req.file.buffer.toString('utf-8');
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return res.redirect('/admin');

    const VALID_CATEGORIES = ['student', 'parent', 'teacher', 'vip', 'guest', 'family'];

    // Detect if first row is a header (contains "name" in any column)
    const firstRow = lines[0].toLowerCase().split(',').map(h => h.trim());
    const hasHeader = firstRow.includes('name');

    let dataLines, colMap;

    if (hasHeader) {
      // Header-based: map columns by name
      dataLines = lines.slice(1);
      colMap = {
        name:    firstRow.indexOf('name'),
        cat:     Math.max(firstRow.indexOf('category'), firstRow.indexOf('type')),
        dietary: Math.max(firstRow.indexOf('dietary'), firstRow.indexOf('dietary_restrictions')),
        table:   Math.max(firstRow.indexOf('table'), firstRow.indexOf('table_number')),
        phone:   firstRow.indexOf('phone'),
        email:   firstRow.indexOf('email'),
        family_size: firstRow.indexOf('family_size'),
      };
    } else {
      // No header: assume positional — name, category, dietary, table, phone, email, family_size
      dataLines = lines;
      colMap = { name: 0, cat: 1, dietary: 2, table: 3, phone: 4, email: 5, family_size: 6 };
    }

    const guestRows = [];
    for (const line of dataLines) {
      const cols = line.split(',').map(c => c.trim());
      const name = colMap.name >= 0 ? cols[colMap.name] : null;
      if (!name) continue;

      const rawCat = (colMap.cat >= 0 ? cols[colMap.cat] : '').toLowerCase();
      const category = VALID_CATEGORIES.includes(rawCat) ? rawCat : 'guest';

      guestRows.push({
        name,
        category,
        dietary: colMap.dietary >= 0 ? cols[colMap.dietary] || null : null,
        table_number: colMap.table >= 0 ? cols[colMap.table] || null : null,
        phone: colMap.phone >= 0 ? cols[colMap.phone] || null : null,
        email: colMap.email >= 0 ? cols[colMap.email] || null : null,
        family_size: colMap.family_size >= 0 ? cols[colMap.family_size] || 1 : 1,
      });
    }

    if (guestRows.length > 0) {
      await db.addGuestsBulk(guestRows, event.id);
      await db.logActivity(event.id, 'import', {
        userId: user.id,
        details: `Imported ${guestRows.length} guests from CSV by ${user.display_name}`,
      });
    }
  } else if (req.body.names) {
    const names = req.body.names.split(/\r?\n/).filter(n => n.trim());
    if (names.length > 0) {
      await db.addGuests(names, event.id);
      await db.logActivity(event.id, 'import', {
        userId: user.id,
        details: `Imported ${names.length} guests (text) by ${user.display_name}`,
      });
    }
  }

  res.redirect('/admin');
});

// ── Add Single Guest ──
router.post('/admin/guest/add', requireAdmin, async (req, res) => {
  const event = await db.getActiveEvent();
  if (!event) return res.redirect('/admin');
  const user = req.session.user;
  const { name, category, dietary, table_number, phone, email, family_size } = req.body;

  if (!name || !name.trim()) return res.redirect('/admin');

  const guest = await db.addSingleGuest(event.id, {
    name, category, dietary_restrictions: dietary, table_number, phone, email,
    family_size: category === 'family' ? family_size : 1,
  });

  await db.logActivity(event.id, 'add_guest', {
    guestId: guest.id,
    userId: user.id,
    details: `${user.display_name} added guest: ${guest.name}`,
  });

  res.redirect('/admin');
});

// ── Delete Single Guest ──
router.post('/admin/guest/:id/delete', requireAdmin, async (req, res) => {
  const guest = await db.getGuestById(Number(req.params.id));
  if (!guest) return res.redirect('/admin');
  const event = await db.getActiveEvent();
  const user = req.session.user;

  await db.deleteGuest(guest.id);

  if (event) {
    await db.logActivity(event.id, 'delete_guest', {
      userId: user.id,
      details: `${user.display_name} deleted guest: ${guest.name}`,
    });
  }
  res.redirect('/admin');
});

// ── Export PDF Tickets ──
router.get('/admin/export-pdf', requireAuth, async (req, res) => {
  const event = await db.getActiveEvent();
  if (!event) return res.status(400).send('No active event.');

  const guests = await db.getAllGuests(event.id);
  if (guests.length === 0) return res.status(400).send('No guests to export.');

  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="iftar-tickets.pdf"');
  await generatePDF(guests, baseUrl, res, event);
});

// ── Single Ticket Reprint ──
router.get('/admin/ticket/:id', requireAuth, async (req, res) => {
  const guest = await db.getGuestById(Number(req.params.id));
  if (!guest) return res.status(404).send('Guest not found');

  const event = await db.getActiveEvent();
  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="ticket-${guest.id}.pdf"`);
  await generateSingleTicket(guest, baseUrl, res, event);
});

// ── CSV Export ──
router.get('/admin/export-csv', requireAdmin, async (req, res) => {
  const event = await db.getActiveEvent();
  if (!event) return res.status(400).send('No active event.');

  const guests = await db.getAllGuests(event.id);
  const users = await db.getAllUsers();
  const userMap = {};
  users.forEach(u => { userMap[u.id] = u.display_name; });

  const header = 'Name,Category,Table,Dietary,Phone,Email,Family Size,Paid,Checked In,Checked In At,Checked In By,Scan Count,Token\n';
  const rows = guests.map(g =>
    [
      `"${(g.name || '').replace(/"/g, '""')}"`,
      g.category || '',
      g.table_number || '',
      `"${(g.dietary_restrictions || '').replace(/"/g, '""')}"`,
      g.phone || '',
      g.email || '',
      g.family_size || 1,
      g.paid ? 'Yes' : 'No',
      g.checked_in ? 'Yes' : 'No',
      g.checked_in_at ? new Date(g.checked_in_at).toLocaleString() : '',
      g.checked_in_by ? (userMap[g.checked_in_by] || 'QR Scan') : '',
      g.scan_count || 0,
      g.token || '',
    ].join(',')
  ).join('\n');

  const BOM = '\uFEFF';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="guests.csv"');
  res.send(BOM + header + rows);
});

// ── Manual Check-in (form POST) ──
router.post('/admin/checkin/:id', requireAuth, async (req, res) => {
  const guest = await db.getGuestById(Number(req.params.id));
  if (!guest || guest.checked_in) return res.redirect('/admin');

  const user = req.session.user;
  const event = await db.getActiveEvent();

  await db.checkInGuest(guest.id, user.id);

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

  res.redirect('/admin');
});

// ── Send Invitations via n8n ──
router.post('/admin/send-invitations', requireSuperAdmin, async (req, res) => {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl) return res.redirect('/admin#invitations');

  const event = await db.getActiveEvent();
  if (!event) return res.redirect('/admin#invitations');

  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

  // Create Ziina payment links per guest if API key is configured
  if (process.env.ZIINA_API_KEY) {
    const guests = await db.getAllGuests(event.id);
    const guestsWithEmail = guests.filter(g => g.email && g.email.trim() && !g.payment_url && !g.paid);
    const amount = parseInt(process.env.ZIINA_AMOUNT) || 50;
    const currency = process.env.ZIINA_CURRENCY || 'AED';
    let created = 0;

    for (const guest of guestsWithEmail) {
      try {
        const guestAmount = amount * (guest.family_size || 1);
        const payment = await ziina.createPaymentIntent({
          amount: guestAmount,
          currency,
          message: `Iftar — ${guest.name}${guest.family_size > 1 ? ` (${guest.family_size} guests)` : ''}`,
          successUrl: `${baseUrl}/payment-success/${guest.token}`,
          cancelUrl: `${baseUrl}/payment-cancelled`,
        });
        await db.setGuestPayment(guest.id, payment.id, payment.redirect_url);
        created++;
      } catch (e) {
        console.error(`Failed to create Ziina payment for ${guest.name}:`, e.message);
      }
    }
    console.log(`Created ${created} Ziina payment links for ${guestsWithEmail.length} guests`);
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send_invitations',
        app_base_url: baseUrl,
        api_key: process.env.N8N_API_KEY,
        event: { name: event.name, date: event.event_date, time: event.event_time, venue: event.venue },
      }),
    });
  } catch (e) {
    console.error('Failed to trigger n8n webhook:', e.message);
  }

  await db.logActivity(event.id, 'send_invitations', {
    userId: req.session.user.id,
    details: `${req.session.user.display_name} triggered email invitations via n8n`,
  });

  res.redirect('/admin#invitations');
});

// ── Send Badges to Paid Guests via n8n ──
router.post('/admin/send-badges', requireSuperAdmin, async (req, res) => {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl) return res.redirect('/admin#invitations');

  const event = await db.getActiveEvent();
  if (!event) return res.redirect('/admin#invitations');

  // Get paid guests who haven't received badges yet
  const pendingGuests = await db.getPaidGuestsWithEmail(event.id);
  if (pendingGuests.length === 0) return res.redirect('/admin#invitations');

  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send_badges',
        app_base_url: baseUrl,
        api_key: process.env.N8N_API_KEY,
        event: { name: event.name, date: event.event_date, time: event.event_time, venue: event.venue },
      }),
    });
    // Note: badges are marked as sent when n8n fetches /api/guests-paid
  } catch (e) {
    console.error('Failed to trigger n8n badge webhook:', e.message);
  }

  await db.logActivity(event.id, 'send_badges', {
    userId: req.session.user.id,
    details: `${req.session.user.display_name} triggered badges for ${pendingGuests.length} paid guests via n8n`,
  });

  res.redirect('/admin#invitations');
});

// ── Ziina Webhook Registration ──
router.post('/admin/ziina-setup', requireSuperAdmin, async (req, res) => {
  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  const webhookUrl = `${baseUrl}/api/webhook/ziina`;
  const secret = process.env.ZIINA_WEBHOOK_SECRET || null;

  try {
    await ziina.registerWebhook(webhookUrl, secret);
    await db.logActivity(null, 'ziina_setup', {
      userId: req.session.user.id,
      details: `${req.session.user.display_name} registered Ziina webhook: ${webhookUrl}`,
    });
    console.log('Ziina webhook registered:', webhookUrl);
  } catch (e) {
    console.error('Failed to register Ziina webhook:', e.message);
  }

  res.redirect('/admin#event-details');
});

// ── Send Feedback Survey via n8n ──
router.post('/admin/send-feedback', requireSuperAdmin, async (req, res) => {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl) return res.redirect('/admin#invitations');

  const event = await db.getActiveEvent();
  if (!event || !event.feedback_url) return res.redirect('/admin#invitations');

  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send_feedback',
        app_base_url: baseUrl,
        api_key: process.env.N8N_API_KEY,
        feedback_url: event.feedback_url,
        event: { name: event.name, date: event.event_date, time: event.event_time, venue: event.venue },
      }),
    });
  } catch (e) {
    console.error('Failed to trigger n8n feedback webhook:', e.message);
  }

  await db.logActivity(event.id, 'send_feedback', {
    userId: req.session.user.id,
    details: `${req.session.user.display_name} triggered feedback survey emails via n8n`,
  });

  res.redirect('/admin#invitations');
});

// ── Reset (delete all guests) ──
router.post('/admin/reset', requireSuperAdmin, async (req, res) => {
  const event = await db.getActiveEvent();
  if (event) {
    await db.deleteAllGuests(event.id);
    await db.logActivity(event.id, 'reset', {
      userId: req.session.user.id,
      details: `All guests deleted by ${req.session.user.display_name}`,
    });
  }
  res.redirect('/admin');
});

// ── Event Settings ──
router.post('/admin/event', requireSuperAdmin, async (req, res) => {
  const event = await db.getActiveEvent();
  if (!event) return res.redirect('/admin');

  await db.updateEvent(event.id, {
    name: req.body.event_name || event.name,
    event_date: req.body.event_date || event.event_date,
    event_time: req.body.event_time || event.event_time,
    venue: req.body.venue || event.venue,
    feedback_url: req.body.feedback_url,
  });
  res.redirect('/admin');
});

// ── User Management ──
router.get('/admin/users', requireSuperAdmin, async (req, res) => {
  const users = await db.getAllUsers();
  res.send(renderUsersPage(users, req.session.user, res.locals.lang || 'en', res.locals.dir || 'ltr', req.query.error, req.query.success));
});

router.post('/admin/users/create', requireSuperAdmin, async (req, res) => {
  const { username, password, display_name, role } = req.body;
  if (!username || !password || !display_name) {
    return res.redirect('/admin/users?error=All+fields+are+required');
  }

  const existing = await db.getUserByUsername(username.trim().toLowerCase());
  if (existing) {
    return res.redirect('/admin/users?error=Username+already+exists');
  }

  const hash = await bcrypt.hash(password, 12);
  await db.createUser({
    username: username.trim().toLowerCase(),
    password_hash: hash,
    display_name: display_name.trim(),
    role: ['admin', 'volunteer'].includes(role) ? role : 'volunteer',
    created_by: req.session.user.id,
  });

  res.redirect('/admin/users?success=User+created');
});

router.post('/admin/users/:id/toggle', requireSuperAdmin, async (req, res) => {
  const user = await db.getUserById(Number(req.params.id));
  if (user && user.id !== req.session.user.id) {
    await db.updateUserActive(user.id, !user.is_active);
  }
  res.redirect('/admin/users');
});

router.post('/admin/users/:id/delete', requireSuperAdmin, async (req, res) => {
  const user = await db.getUserById(Number(req.params.id));
  if (!user) return res.redirect('/admin/users');
  if (user.id === req.session.user.id) return res.redirect('/admin/users?error=Cannot+delete+yourself');
  if (user.role === 'superadmin') return res.redirect('/admin/users?error=Cannot+delete+a+superadmin');

  // Clear foreign key references before deleting
  await db.pool.query('UPDATE announcements SET created_by = NULL WHERE created_by = $1', [user.id]);
  await db.pool.query('UPDATE activity_log SET user_id = NULL WHERE user_id = $1', [user.id]);
  await db.pool.query('UPDATE guests SET checked_in_by = NULL WHERE checked_in_by = $1', [user.id]);
  await db.pool.query('DELETE FROM users WHERE id = $1', [user.id]);

  const event = await db.getActiveEvent();
  if (event) {
    await db.logActivity(event.id, 'delete_user', {
      userId: req.session.user.id,
      details: `${req.session.user.display_name} deleted user: ${user.display_name} (${user.username})`,
    });
  }

  res.redirect('/admin/users?success=User+deleted');
});

// ── Report PDF ──
router.get('/admin/report-pdf', requireAdmin, async (req, res) => {
  const event = await db.getActiveEvent();
  if (!event) return res.status(400).send('No active event.');
  const guests = await db.getAllGuests(event.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="iftar-report.pdf"');
  await generateReport(event, guests, res);
});

// ── Walk-in Registration ──
router.get('/walkin', requireAuth, async (req, res) => {
  const event = await db.getActiveEvent();
  if (!event) return res.send('No active event.');
  res.send(renderWalkin(req.session.user, event, res.locals.lang || 'en', res.locals.dir || 'ltr'));
});

router.post('/walkin/register', requireAuth, async (req, res) => {
  const event = await db.getActiveEvent();
  if (!event) return res.redirect('/walkin');
  const user = req.session.user;
  const { name, category, table_number } = req.body;

  if (!name || !name.trim()) return res.redirect('/walkin');

  const guest = await db.addSingleGuest(event.id, {
    name, category: category || 'guest', table_number, dietary_restrictions: null, phone: null, email: null, family_size: 1,
  });

  await db.checkInGuest(guest.id, user.id);

  await db.logActivity(event.id, 'walkin_registration', {
    guestId: guest.id,
    userId: user.id,
    details: `Walk-in: ${guest.name} registered and checked in by ${user.display_name}`,
  });

  if (req.app.locals.broadcast) {
    req.app.locals.broadcast({
      type: 'checkin',
      guest: { id: guest.id, name: guest.name, category: guest.category },
      user: { display_name: user.display_name },
      timestamp: new Date().toISOString(),
    });
  }

  res.send(renderWalkinSuccess(req.session.user, event, guest, res.locals.lang || 'en', res.locals.dir || 'ltr'));
});

// ── Kiosk Mode ──
router.get('/kiosk', (req, res) => {
  res.send(renderKiosk());
});

// ── Render Functions ──

function renderNav(user, activePage = 'registration', lang = 'en') {
  const _isAdmin = isAdmin(user);
  const _isSuperAdmin = isSuperAdmin(user);
  const L = (key) => t(lang, key);

  const tabs = [
    { id: 'registration', label: L('nav.registration'), icon: '&#128203;', minRole: 'volunteer' },
    { id: 'event-details', label: L('nav.event_details'), icon: '&#9881;', minRole: 'admin' },
    { id: 'invitations', label: L('nav.invitations'), icon: '&#9993;', minRole: 'superadmin' },
    { id: 'reports', label: L('nav.reports'), icon: '&#128202;', minRole: 'admin' },
  ].filter(tab => {
    if (tab.minRole === 'volunteer') return true;
    if (tab.minRole === 'admin') return _isAdmin;
    if (tab.minRole === 'superadmin') return _isSuperAdmin;
    return false;
  });

  const isDashboard = ['registration', 'event-details', 'invitations', 'reports'].includes(activePage);

  const tabLinks = tabs.map(tab => {
    const isActive = activePage === tab.id;
    if (isDashboard) {
      return `<a href="#" class="nav-tab ${isActive ? 'nav-tab-active' : ''}" onclick="switchTab('${tab.id}')" data-tab="${tab.id}">${tab.icon} ${tab.label}</a>`;
    }
    return `<a href="/admin#${tab.id}" class="nav-tab">${tab.icon} ${tab.label}</a>`;
  }).join('');

  const adminLinks = _isSuperAdmin ? `
    <a href="/admin/users" class="nav-tab ${activePage === 'users' ? 'nav-tab-active' : ''}">&#128101; ${L('nav.users')}</a>
  ` : '';

  const langToggle = lang === 'ar'
    ? '<a href="?lang=en" class="nav-tab">EN</a>'
    : '<a href="?lang=ar" class="nav-tab">عربي</a>';

  return `<nav class="navbar">
    <div class="nav-brand">${MOON_SVG(22)} ${L('nav.brand')}</div>
    <div class="nav-links">
      ${tabLinks}
      ${adminLinks}
      <a href="/walkin" class="nav-tab ${activePage === 'walkin' ? 'nav-tab-active' : ''}">&#128694; ${L('nav.walkin')}</a>
      <a href="/kiosk" class="nav-tab" target="_blank">&#128247; ${L('nav.kiosk')}</a>
      ${langToggle}
      <span class="nav-user">${escapeHtml(user.display_name)} <span class="role-badge role-${user.role}">${user.role === 'superadmin' ? 'super admin' : user.role}</span></span>
      <a href="/logout" class="nav-tab nav-logout">${L('nav.logout')}</a>
    </div>
  </nav>`;
}

function renderDashboard(event, user, lang = 'en', dir = 'ltr') {
  const _isAdmin = isAdmin(user);
  const _isSuperAdmin = isSuperAdmin(user);
  const L = (key) => t(lang, key);

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(event.name)} — Dashboard</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  ${renderNav(user, 'registration', lang)}
  <div class="container">
    <h1>${escapeHtml(event.name)}</h1>
    <p class="event-info">${escapeHtml(event.event_date)} at ${escapeHtml(event.event_time)} — ${escapeHtml(event.venue)}</p>

    <!-- Announcement Banner (shown via JS) -->
    <div id="announcement-banner" class="announcement-banner" style="display:none">
      <span id="announcement-text"></span>
      ${_isAdmin ? '<button class="announcement-dismiss" onclick="dismissAnnouncement()">&#10005;</button>' : ''}
    </div>

    <!-- ══════════════════════════════════ -->
    <!-- TAB: Registration                 -->
    <!-- ══════════════════════════════════ -->
    <div id="tab-registration" class="tab-content tab-active">

      <!-- Announcement Broadcast -->
      <div class="card">
        <h2>&#128227; ${L('announce.title')}</h2>
        <div class="form-row">
          <input type="text" id="announcement-msg" placeholder="${L('announce.placeholder')}" style="flex:3">
          <select id="announcement-type" style="flex:1;min-width:100px">
            <option value="info">${L('announce.info')}</option>
            <option value="success">${L('announce.success')}</option>
            <option value="warning">${L('announce.warning')}</option>
          </select>
          <button class="btn btn-gold" onclick="broadcastAnnouncement()">${L('btn.broadcast')}</button>
        </div>
      </div>

      <!-- Stats Cards -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-number" id="stat-total">-</div>
          <div class="stat-label">${L('stats.total')}</div>
        </div>
        <div class="stat-card stat-checked">
          <div class="stat-number" id="stat-checked">-</div>
          <div class="stat-label">${L('stats.checked_in')}</div>
        </div>
        <div class="stat-card stat-pending">
          <div class="stat-number" id="stat-pending">-</div>
          <div class="stat-label">${L('stats.pending')}</div>
        </div>
        <div class="stat-card stat-percent">
          <div class="stat-number" id="stat-percent">-</div>
          <div class="stat-label">${L('stats.progress')}</div>
          <div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
        </div>
      </div>

      <!-- Activity Feed + Chart -->
      <div class="dashboard-grid">
        <div class="card">
          <h2>${L('dashboard.live_activity')}</h2>
          <div id="activity-feed" class="activity-feed">
            <p class="muted">${L('dashboard.waiting')}</p>
          </div>
        </div>
        <div class="card">
          <h2>${L('dashboard.timeline')}</h2>
          <canvas id="timeline-chart" width="400" height="200"></canvas>
        </div>
      </div>

      ${_isAdmin ? `
      <div class="card">
        <h2>${L('dashboard.add_guest')}</h2>
        <form method="POST" action="/admin/guest/add" class="guest-add-form">
          <div class="form-row">
            <input type="text" name="name" placeholder="${L('form.guest_name')}" required>
            <select name="category" onchange="document.getElementById('family-size-wrap').style.display=this.value==='family'?'':'none'">
              <option value="guest">Guest</option>
              <option value="student">Student</option>
              <option value="parent">Parent</option>
              <option value="teacher">Teacher</option>
              <option value="vip">VIP</option>
              <option value="family">Family</option>
            </select>
            <span id="family-size-wrap" style="display:none">
              <input type="number" name="family_size" min="1" value="2" placeholder="Members" style="width:80px">
            </span>
            <input type="text" name="table_number" placeholder="${L('form.table_number')}">
          </div>
          <div class="form-row" style="margin-top:10px">
            <input type="text" name="dietary" placeholder="${L('form.dietary')}">
            <input type="text" name="phone" placeholder="${L('form.phone')}">
            <input type="text" name="email" placeholder="${L('form.email')}">
            <button type="submit" class="btn btn-primary">${L('btn.add_guest')}</button>
          </div>
        </form>
      </div>

      <div class="card">
        <h2>${L('dashboard.bulk_import')}</h2>
        <form method="POST" action="/admin/import" enctype="multipart/form-data">
          <textarea name="names" placeholder="${L('form.paste_names')}" rows="3"></textarea>
          <p class="muted" style="font-size:0.8rem;margin:6px 0">${L('form.csv_hint')}</p>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">${L('btn.import')}</button>
            <label class="btn btn-secondary file-upload">
              ${L('btn.upload_csv')}
              <input type="file" name="csv" accept=".csv,.txt" hidden onchange="this.form.submit()">
            </label>
            <a href="/admin/export-pdf" class="btn btn-gold">${L('btn.download_tickets')}</a>
            <a href="/admin/export-csv" class="btn btn-secondary">${L('btn.export_csv')}</a>
          </div>
        </form>
      </div>
      ` : ''}

      <!-- Guest List -->
      <div class="card">
        <h2>${L('dashboard.guest_list')}</h2>
        <input type="text" class="search-box" id="search" placeholder="${L('dashboard.search')}">
        <div class="table-wrapper">
          <table class="guest-table">
            <thead>
              <tr>
                <th>${L('table.name')}</th>
                <th>${L('table.category')}</th>
                <th>${L('table.table')}</th>
                <th>${L('table.dietary')}</th>
                ${_isAdmin ? '<th>Paid</th>' : ''}
                ${_isAdmin ? '<th>Badge</th>' : ''}
                <th>${L('table.status')}</th>
                <th>${L('table.time')}</th>
                <th>${L('table.actions')}</th>
              </tr>
            </thead>
            <tbody id="guest-list"></tbody>
          </table>
        </div>
      </div>

      ${_isSuperAdmin ? `
      <div class="card card-danger">
        <h2>${L('dashboard.danger_zone')}</h2>
        <form method="POST" action="/admin/reset" id="reset-form">
          <button type="submit" class="btn btn-danger">${L('dashboard.clear_all')}</button>
        </form>
      </div>
      ` : ''}
    </div>

    ${_isAdmin ? `
    <!-- ══════════════════════════════════ -->
    <!-- TAB: Event Details                -->
    <!-- ══════════════════════════════════ -->
    <div id="tab-event-details" class="tab-content" style="display:none">
      <div class="card">
        <h2>${L('event.info')}</h2>
        <div class="event-details-grid">
          <div class="event-detail-item">
            <span class="event-detail-label">${L('event.name')}</span>
            <span class="event-detail-value">${escapeHtml(event.name)}</span>
          </div>
          <div class="event-detail-item">
            <span class="event-detail-label">${L('event.date')}</span>
            <span class="event-detail-value">${escapeHtml(event.event_date)}</span>
          </div>
          <div class="event-detail-item">
            <span class="event-detail-label">${L('event.time')}</span>
            <span class="event-detail-value">${escapeHtml(event.event_time)}</span>
          </div>
          <div class="event-detail-item">
            <span class="event-detail-label">${L('event.venue')}</span>
            <span class="event-detail-value">${escapeHtml(event.venue)}</span>
          </div>
        </div>
      </div>

      ${_isSuperAdmin ? `
      <div class="card">
        <h2>${L('event.edit')}</h2>
        <form method="POST" action="/admin/event" class="event-form">
          <div class="form-row">
            <input type="text" name="event_name" value="${escapeHtml(event.name)}" placeholder="Event Name">
            <input type="text" name="event_date" value="${escapeHtml(event.event_date)}" placeholder="Date">
          </div>
          <div class="form-row" style="margin-top:10px">
            <input type="text" name="event_time" value="${escapeHtml(event.event_time)}" placeholder="Time">
            <input type="text" name="venue" value="${escapeHtml(event.venue)}" placeholder="Venue">
          </div>
          <div class="form-row" style="margin-top:10px">
            <input type="text" name="feedback_url" value="${escapeHtml(event.feedback_url || '')}" placeholder="Feedback Form URL (optional)">
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">${L('btn.save')}</button>
          </div>
        </form>
      </div>
      ` : ''}

      ${_isSuperAdmin ? `
      <div class="card">
        <h2>&#128179; Ziina Payment Gateway</h2>
        <div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:16px">
          <div style="flex:1;min-width:200px;background:rgba(124,58,237,0.06);border:1px solid rgba(124,58,237,0.2);border-radius:8px;padding:16px">
            <p style="color:#8899aa;font-size:0.8rem;margin:0 0 4px">API Key</p>
            <p style="color:${process.env.ZIINA_API_KEY ? '#2ecc71' : '#e74c3c'};font-weight:600;margin:0;font-size:0.95rem">
              ${process.env.ZIINA_API_KEY ? '&#9989; Configured' : '&#10060; Not configured'}
            </p>
          </div>
          <div style="flex:1;min-width:200px;background:rgba(212,175,55,0.06);border:1px solid rgba(212,175,55,0.2);border-radius:8px;padding:16px">
            <p style="color:#8899aa;font-size:0.8rem;margin:0 0 4px">Payment Amount</p>
            <p style="color:#d4af37;font-weight:600;margin:0;font-size:0.95rem">${process.env.ZIINA_AMOUNT || '50'} ${process.env.ZIINA_CURRENCY || 'AED'}</p>
          </div>
          <div style="flex:1;min-width:200px;background:rgba(46,204,113,0.06);border:1px solid rgba(46,204,113,0.2);border-radius:8px;padding:16px">
            <p style="color:#8899aa;font-size:0.8rem;margin:0 0 4px">Test Mode</p>
            <p style="color:${process.env.ZIINA_TEST_MODE === 'true' ? '#f39c12' : '#2ecc71'};font-weight:600;margin:0;font-size:0.95rem">
              ${process.env.ZIINA_TEST_MODE === 'true' ? '&#9888; Test Mode' : 'Live Mode'}
            </p>
          </div>
        </div>
        ${process.env.ZIINA_API_KEY ? `
        <p class="muted" style="font-size:0.85rem;margin-bottom:12px">Register the webhook so Ziina notifies your server when guests pay. Only needs to be done once.</p>
        <form method="POST" action="/admin/ziina-setup">
          <button type="submit" class="btn btn-primary" onclick="return confirm('Register Ziina webhook for payment notifications?')" style="background:linear-gradient(135deg,#7C3AED,#5B21B6)">Register Ziina Webhook</button>
        </form>
        ` : `
        <p style="color:#f39c12;font-size:0.85rem;margin:0">Add <strong>ZIINA_API_KEY</strong> to your environment variables to enable automatic payment links.</p>
        `}
      </div>
      ` : ''}
    </div>
    ` : '<!-- Event Details tab hidden for volunteers -->'}

    ${_isSuperAdmin ? `
    <!-- ══════════════════════════════════ -->
    <!-- TAB: Invitations                  -->
    <!-- ══════════════════════════════════ -->
    <div id="tab-invitations" class="tab-content" style="display:none">
      <div class="card">
        <h2>${L('invite.title')}</h2>
        <p class="muted" style="margin-bottom:16px">${L('invite.desc')}</p>

        ${process.env.N8N_WEBHOOK_URL ? `
        <div class="invitation-actions" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start">
          <div>
            <form method="POST" action="/admin/send-invitations">
              <button type="submit" class="btn btn-gold" onclick="return confirm('Send payment invitation emails to all guests? (No badge attached)')">&#9993; Send Invitations</button>
            </form>
            <p class="muted" style="font-size:0.8rem;margin-top:6px">Sends event details + Ziina payment link.<br><strong>No badge/QR code attached.</strong></p>
          </div>
          <div>
            <form method="POST" action="/admin/send-badges">
              <button type="submit" class="btn btn-primary" onclick="return confirm('Send badge emails to all PAID guests who have an email address?')" style="background:linear-gradient(135deg,#27ae60,#1e8449)">&#127915; Send Badges to Paid</button>
            </form>
            <p class="muted" style="font-size:0.8rem;margin-top:6px">Sends QR badge to guests marked as <strong>Paid</strong>.<br>Mark guests as paid in the Registration tab.</p>
          </div>
        </div>
        ` : `
        <div style="background:rgba(243,156,18,0.1);border:1px solid rgba(243,156,18,0.3);border-radius:8px;padding:16px;margin-bottom:16px">
          <p style="color:#f39c12;margin:0;font-size:0.9rem">n8n webhook not configured. Add <strong>N8N_WEBHOOK_URL</strong> to your environment variables to enable email invitations.</p>
        </div>
        `}
      </div>

      <div class="card">
        <h2>${L('invite.download')}</h2>
        <p class="muted" style="margin-bottom:16px">${L('invite.download_desc')}</p>
        <a href="/admin/export-pdf" class="btn btn-gold">${L('btn.download_tickets')}</a>
      </div>

      ${event.feedback_url ? `
      <div class="card">
        <h2>Feedback Survey</h2>
        <p class="muted" style="margin-bottom:12px">Send the feedback form to all checked-in guests who have an email address.</p>
        <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:12px">Survey URL: <a href="${escapeHtml(event.feedback_url)}" target="_blank" style="color:var(--gold)">${escapeHtml(event.feedback_url)}</a></p>
        ${process.env.N8N_WEBHOOK_URL ? `
        <form method="POST" action="/admin/send-feedback">
          <button type="submit" class="btn btn-gold" onclick="return confirm('Send feedback survey to all checked-in guests with email addresses?')">Send Feedback Survey</button>
        </form>
        ` : '<p style="color:#f39c12;font-size:0.85rem">n8n webhook not configured.</p>'}
      </div>
      ` : ''}

      <!-- Invitation Email Preview (payment only, no badge) -->
      <div class="card">
        <h2>&#9993; Invitation Email Preview</h2>
        <p class="muted" style="margin-bottom:16px">This is what guests receive when you click "Send Invitations" — unique Ziina payment link per guest, no badge.</p>
        ${process.env.ZIINA_API_KEY ? '<p style="color:#2ecc71;font-size:0.85rem;margin-bottom:12px">&#9989; Ziina links will be auto-generated per guest when you send invitations.</p>' : '<p style="color:#f39c12;font-size:0.85rem;margin-bottom:12px">&#9888; Set ZIINA_API_KEY to auto-generate unique payment links per guest.</p>'}
        <div style="background:#0a1628;border-radius:12px;padding:0;border:2px solid #d4af37;overflow:hidden;max-width:480px;margin:0 auto">
          <div style="height:5px;background:linear-gradient(90deg,#b8942e,#d4af37,#f0d060,#d4af37,#b8942e)"></div>
          <div style="background:linear-gradient(180deg,#0f1f3a 0%,#162d4a 50%,#0f1f3a 100%);padding:32px 24px">
            <div style="text-align:center">
              <div style="font-size:2.4rem;margin-bottom:10px">&#127769;</div>
              <h3 style="color:#d4af37;margin:0 0 4px;font-size:1.15rem;font-weight:700;letter-spacing:0.5px">${escapeHtml(event.name)}</h3>
              <p style="color:#8899aa;font-size:0.78rem;margin:0 0 18px">${L('invite.cordially')}</p>
              <div style="height:1px;background:linear-gradient(90deg,transparent,#d4af37,transparent);margin:0 40px 4px"></div>
              <div style="color:#d4af37;font-size:6px;margin-bottom:18px">&#9670;</div>
              <p style="color:#8899aa;font-size:0.7rem;text-transform:uppercase;letter-spacing:2px;margin:0 0 6px">Dear Guest</p>
              <p style="color:#fff;font-size:1.4rem;font-weight:700;margin:0 0 16px">Guest Name</p>
              <div style="display:inline-block;background:rgba(212,175,55,0.08);border:1px solid rgba(212,175,55,0.2);border-radius:10px;padding:16px 24px;margin-bottom:16px">
                <span style="color:#d4af37;font-size:0.65rem;text-transform:uppercase;letter-spacing:1px">DATE</span>
                <div style="color:#fff;font-size:0.95rem;font-weight:600;margin-bottom:6px">${escapeHtml(event.event_date)}</div>
                <span style="color:#d4af37;font-size:0.65rem;text-transform:uppercase;letter-spacing:1px">TIME</span>
                <div style="color:#fff;font-size:0.95rem;font-weight:600;margin-bottom:6px">${escapeHtml(event.event_time)}</div>
                <span style="color:#d4af37;font-size:0.65rem;text-transform:uppercase;letter-spacing:1px">VENUE</span>
                <div style="color:#fff;font-size:0.95rem;font-weight:600">${escapeHtml(event.venue)}</div>
              </div>
              <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(212,175,55,0.3),transparent);margin:0 30px 16px"></div>
              <div style="background:rgba(124,58,237,0.06);border:1px solid rgba(124,58,237,0.2);border-radius:10px;padding:16px 20px;margin:0 auto 16px;max-width:320px">
                <p style="color:#bcc5d0;font-size:0.82rem;margin:0 0 10px">Secure your spot by paying below:</p>
                <div style="display:inline-block;background:linear-gradient(135deg,#7C3AED,#5B21B6);border-radius:6px;padding:10px 28px;margin-bottom:8px">
                  <span style="color:#fff;font-size:0.9rem;font-weight:700">Pay with Ziina</span>
                </div>
                <p style="color:#6b7a8d;font-size:0.65rem;margin:0">&#128274; Secure payment powered by <span style="color:#7C3AED;font-weight:700">ziina</span></p>
              </div>
              <div style="background:rgba(243,156,18,0.08);border:1px solid rgba(243,156,18,0.2);border-radius:8px;padding:10px 16px;margin:0 auto 16px;max-width:320px">
                <p style="color:#f39c12;font-size:0.78rem;margin:0;font-weight:600">&#9888; Your badge will be sent after payment is confirmed</p>
              </div>
              <p style="color:#8899aa;font-size:0.8rem;margin:0 0 4px">We look forward to seeing you!</p>
              <p style="color:#d4af37;font-size:0.9rem;font-weight:600;margin:0">${L('ramadan_kareem')} &#127769;</p>
            </div>
          </div>
          <div style="height:3px;background:linear-gradient(90deg,#b8942e,#d4af37,#f0d060,#d4af37,#b8942e)"></div>
        </div>
      </div>

      <!-- Badge Email Preview -->
      <div class="card">
        <h2>&#127915; Badge Email Preview</h2>
        <p class="muted" style="margin-bottom:16px">This is what <strong>paid</strong> guests receive when you click "Send Badges to Paid" — badge attached, no payment link.</p>
        <div style="background:#0a1628;border-radius:12px;padding:0;border:2px solid #d4af37;overflow:hidden;max-width:480px;margin:0 auto">
          <div style="height:5px;background:linear-gradient(90deg,#b8942e,#d4af37,#f0d060,#d4af37,#b8942e)"></div>
          <div style="background:linear-gradient(180deg,#0f1f3a 0%,#162d4a 50%,#0f1f3a 100%);padding:32px 24px">
            <div style="text-align:center">
              <div style="font-size:2.4rem;margin-bottom:10px">&#127769;</div>
              <h3 style="color:#d4af37;margin:0 0 4px;font-size:1.15rem;font-weight:700;letter-spacing:0.5px">${escapeHtml(event.name)}</h3>
              <p style="color:#8899aa;font-size:0.78rem;margin:0 0 18px">${L('invite.cordially')}</p>
              <div style="height:1px;background:linear-gradient(90deg,transparent,#d4af37,transparent);margin:0 40px 4px"></div>
              <div style="color:#d4af37;font-size:6px;margin-bottom:18px">&#9670;</div>
              <p style="color:#8899aa;font-size:0.7rem;text-transform:uppercase;letter-spacing:2px;margin:0 0 6px">Dear Guest</p>
              <p style="color:#fff;font-size:1.4rem;font-weight:700;margin:0 0 16px">Guest Name</p>
              <div style="display:inline-block;background:rgba(212,175,55,0.08);border:1px solid rgba(212,175,55,0.2);border-radius:10px;padding:16px 24px;margin-bottom:16px">
                <span style="color:#d4af37;font-size:0.65rem;text-transform:uppercase;letter-spacing:1px">DATE</span>
                <div style="color:#fff;font-size:0.95rem;font-weight:600;margin-bottom:6px">${escapeHtml(event.event_date)}</div>
                <span style="color:#d4af37;font-size:0.65rem;text-transform:uppercase;letter-spacing:1px">TIME</span>
                <div style="color:#fff;font-size:0.95rem;font-weight:600;margin-bottom:6px">${escapeHtml(event.event_time)}</div>
                <span style="color:#d4af37;font-size:0.65rem;text-transform:uppercase;letter-spacing:1px">VENUE</span>
                <div style="color:#fff;font-size:0.95rem;font-weight:600">${escapeHtml(event.venue)}</div>
              </div>
              <div style="background:rgba(46,204,113,0.12);border:1px solid rgba(46,204,113,0.25);border-radius:8px;padding:12px 16px;margin:0 auto 16px;max-width:300px">
                <p style="color:#2ecc71;margin:0;font-size:0.82rem;font-weight:600">&#128206; Your invitation badge is attached</p>
                <p style="color:#8899aa;font-size:0.7rem;margin:4px 0 0">Print it or have the QR code ready on your phone</p>
              </div>
              <div style="background:rgba(46,204,113,0.08);border:1px solid rgba(46,204,113,0.2);border-radius:8px;padding:10px 16px;margin:0 auto 16px;max-width:320px">
                <p style="color:#2ecc71;font-size:0.78rem;margin:0;font-weight:600">&#9989; Payment confirmed — you're all set!</p>
              </div>
              <p style="color:#8899aa;font-size:0.8rem;margin:0 0 4px">We look forward to seeing you!</p>
              <p style="color:#d4af37;font-size:0.9rem;font-weight:600;margin:0">${L('ramadan_kareem')} &#127769;</p>
            </div>
          </div>
          <div style="height:3px;background:linear-gradient(90deg,#b8942e,#d4af37,#f0d060,#d4af37,#b8942e)"></div>
        </div>
      </div>
    </div>
    ` : '<!-- Invitations tab hidden for non-superadmins -->'}

    ${_isAdmin ? `
    <!-- ══════════════════════════════════ -->
    <!-- TAB: Reports                      -->
    <!-- ══════════════════════════════════ -->
    <div id="tab-reports" class="tab-content" style="display:none">
      <div class="card">
        <h2>${L('report.quick_stats')}</h2>
        <div class="stats-grid" id="report-stats">
          <div class="stat-card">
            <div class="stat-number" id="report-total">-</div>
            <div class="stat-label">${L('report.total')}</div>
          </div>
          <div class="stat-card stat-checked">
            <div class="stat-number" id="report-checked">-</div>
            <div class="stat-label">${L('report.checked')}</div>
          </div>
          <div class="stat-card stat-pending">
            <div class="stat-number" id="report-noshows">-</div>
            <div class="stat-label">${L('report.noshows')}</div>
          </div>
          <div class="stat-card stat-percent">
            <div class="stat-number" id="report-rate">-</div>
            <div class="stat-label">${L('report.rate')}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>${L('report.download')}</h2>
        <p class="muted" style="margin-bottom:16px">${L('report.download_desc')}</p>
        <a href="/admin/report-pdf" class="btn btn-gold">${L('report.download_btn')}</a>
      </div>
    </div>
    ` : '<!-- Reports tab hidden for volunteers -->'}

  </div>

  <script>window.__USER_ROLE__ = '${user.role}';</script>
  <script src="/dashboard.js"></script>
  <script src="/offline.js"></script>
  <script>
    document.getElementById('reset-form')?.addEventListener('submit', function(e) {
      if (!confirm('${L('confirm_delete_all')}')) e.preventDefault();
    });

    function switchTab(tabId) {
      // Hide all tabs
      document.querySelectorAll('.tab-content').forEach(el => {
        el.style.display = 'none';
        el.classList.remove('tab-active');
      });
      // Deactivate all nav tabs
      document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('nav-tab-active'));
      // Show selected tab
      const tab = document.getElementById('tab-' + tabId);
      if (tab) {
        tab.style.display = 'block';
        tab.classList.add('tab-active');
      }
      // Activate nav tab
      const navTab = document.querySelector('.nav-tab[data-tab="' + tabId + '"]');
      if (navTab) navTab.classList.add('nav-tab-active');
      // Save to URL hash
      history.replaceState(null, '', '#' + tabId);
    }

    // Restore tab from URL hash
    (function() {
      const hash = location.hash.replace('#', '');
      if (hash && document.getElementById('tab-' + hash)) {
        switchTab(hash);
      }
    })();
  </script>
</body>
</html>`;
}

function renderUsersPage(users, currentUser, lang = 'en', dir = 'ltr', error = '', success = '') {
  const L = (key) => t(lang, key);
  const rows = users.map(u => `
    <tr class="${u.is_active ? '' : 'row-inactive'}">
      <td>${escapeHtml(u.display_name)}</td>
      <td>${escapeHtml(u.username)}</td>
      <td><span class="role-badge role-${u.role}">${u.role}</span></td>
      <td><span class="badge ${u.is_active ? 'badge-checked' : 'badge-inactive'}">${u.is_active ? L('users.active') : L('users.inactive')}</span></td>
      <td>${u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</td>
      <td>
        ${u.id !== currentUser.id ? `
          <form method="POST" action="/admin/users/${u.id}/toggle" style="display:inline">
            <button type="submit" class="btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-primary'}">
              ${u.is_active ? L('users.deactivate') : L('users.activate')}
            </button>
          </form>
          ${u.role !== 'superadmin' ? `<form method="POST" action="/admin/users/${u.id}/delete" style="display:inline;margin-left:4px">
            <button type="submit" class="btn btn-sm btn-danger" onclick="return confirm('Delete user ${escapeHtml(u.display_name)}? This cannot be undone.')">Delete</button>
          </form>` : ''}
        ` : `<span class="muted">${L('users.you')}</span>`}
      </td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${L('users.title')}</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  ${renderNav(currentUser, 'users', lang)}
  <div class="container">
    <h1>${L('users.title')}</h1>

    ${error ? `<div style="background:rgba(231,76,60,0.15);border:1px solid rgba(231,76,60,0.3);border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#e74c3c;font-weight:600">${escapeHtml(error)}</div>` : ''}
    ${success ? `<div style="background:rgba(46,204,113,0.15);border:1px solid rgba(46,204,113,0.3);border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#2ecc71;font-weight:600">${escapeHtml(success)}</div>` : ''}

    <div class="card">
      <h2>${L('users.create')}</h2>
      <form method="POST" action="/admin/users/create" class="user-form">
        <div class="form-row">
          <input type="text" name="username" placeholder="${L('users.username')}" required>
          <input type="password" name="password" placeholder="${L('users.password')}" required>
          <input type="text" name="display_name" placeholder="${L('users.display_name')}" required>
          <select name="role">
            <option value="volunteer">Volunteer</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" class="btn btn-primary">Create</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h2>${L('users.all')}</h2>
      <div class="table-wrapper">
        <table class="guest-table">
          <thead>
            <tr>
              <th>${L('table.name')}</th>
              <th>${L('users.username')}</th>
              <th>${L('users.role')}</th>
              <th>${L('users.status')}</th>
              <th>${L('users.last_login')}</th>
              <th>${L('table.actions')}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function renderKiosk() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iftar Kiosk — Scan QR</title>
  <link rel="stylesheet" href="/style.css">
  <style>
    body { background: #0a1628; overflow: hidden; }
    .kiosk-container {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      min-height: 100vh; padding: 20px; text-align: center;
    }
    .kiosk-title { color: #d4af37; font-size: 2rem; margin-bottom: 20px; }
    .kiosk-video-wrap {
      position: relative; width: 400px; height: 400px; border-radius: 20px;
      overflow: hidden; border: 3px solid #d4af37; margin-bottom: 20px;
    }
    #kiosk-video { width: 100%; height: 100%; object-fit: cover; }
    .scan-overlay {
      position: absolute; inset: 0; border: 3px solid rgba(212,175,55,0.5);
      border-radius: 20px; pointer-events: none;
    }
    .scan-line {
      position: absolute; top: 0; left: 10%; right: 10%; height: 3px;
      background: #d4af37; animation: scan 2s ease-in-out infinite;
    }
    @keyframes scan { 0%,100% { top: 10%; } 50% { top: 85%; } }
    #kiosk-result {
      font-size: 1.5rem; color: white; padding: 20px;
      border-radius: 12px; min-width: 350px; display: none;
    }
    #kiosk-result.success { background: rgba(39,174,96,0.3); border: 2px solid #27ae60; }
    #kiosk-result.already { background: rgba(243,156,18,0.3); border: 2px solid #f39c12; }
    #kiosk-result.error { background: rgba(192,57,43,0.3); border: 2px solid #c0392b; }
    .kiosk-instructions { color: #8899aa; font-size: 1.1rem; }
  </style>
</head>
<body>
  <div class="kiosk-container">
    <h1 class="kiosk-title">${MOON_SVG(36)} Iftar Check-in</h1>
    <div class="kiosk-video-wrap">
      <video id="kiosk-video" autoplay playsinline></video>
      <div class="scan-overlay"><div class="scan-line"></div></div>
    </div>
    <div id="kiosk-result"></div>
    <p class="kiosk-instructions">Hold your QR code in front of the camera</p>
  </div>
  <script src="/kiosk.js"></script>
</body>
</html>`;
}

function renderWalkin(user, event, lang = 'en', dir = 'ltr') {
  const L = (key) => t(lang, key);
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${L('walkin.title')}</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  ${renderNav(user, 'walkin', lang)}
  <div class="container" style="max-width:500px">
    <h1>${L('walkin.title')}</h1>
    <p class="event-info">${escapeHtml(event.name)}</p>
    <div class="card">
      <h2>${L('walkin.register')}</h2>
      <form method="POST" action="/walkin/register">
        <input type="text" name="name" placeholder="${L('form.guest_name')}" required autofocus style="margin-bottom:12px">
        <select name="category" style="margin-bottom:12px">
          <option value="guest">${L('cat.guest')}</option>
          <option value="student">${L('cat.student')}</option>
          <option value="parent">${L('cat.parent')}</option>
          <option value="teacher">${L('cat.teacher')}</option>
          <option value="vip">${L('cat.vip')}</option>
          <option value="family">${L('cat.family')}</option>
        </select>
        <input type="text" name="table_number" placeholder="${L('walkin.table')}" style="margin-bottom:12px">
        <button type="submit" class="btn btn-primary" style="width:100%;padding:14px;font-size:1.1rem">${L('walkin.register')}</button>
      </form>
    </div>
  </div>
</body>
</html>`;
}

function renderWalkinSuccess(user, event, guest, lang = 'en', dir = 'ltr') {
  const L = (key) => t(lang, key);
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${L('walkin.title')} — &#9989;</title>
  <link rel="stylesheet" href="/style.css">
  <meta http-equiv="refresh" content="3;url=/walkin">
</head>
<body>
  ${renderNav(user, 'walkin', lang)}
  <div class="container" style="max-width:500px">
    <div class="card" style="text-align:center;padding:40px 24px">
      <div style="font-size:3rem;margin-bottom:12px">&#9989;</div>
      <h2 style="color:var(--green-light);font-size:1.4rem">${escapeHtml(guest.name)}</h2>
      <p style="color:var(--text-muted);margin-top:8px">${L('walkin.success')}</p>
      ${guest.table_number ? `<p style="color:var(--gold);font-size:1.2rem;margin-top:12px">${L('table.table')}: ${escapeHtml(guest.table_number)}</p>` : ''}
      <p class="muted" style="margin-top:16px;font-size:0.85rem">${L('walkin.redirect')}</p>
    </div>
  </div>
</body>
</html>`;
}

module.exports = router;
