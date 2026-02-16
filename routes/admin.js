const express = require('express');
const multer = require('multer');
const bcrypt = require('bcrypt');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { generatePDF, generateSingleTicket } = require('../generate-pdf');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CATEGORY_COLORS = {
  student: '#3498db',
  parent: '#2ecc71',
  teacher: '#9b59b6',
  vip: '#f39c12',
  guest: '#95a5a6',
};

// ── Dashboard ──
router.get('/admin', requireAuth, async (req, res) => {
  const event = await db.getActiveEvent();
  if (!event) return res.send('No active event found.');
  const user = req.session.user;

  res.send(renderDashboard(event, user));
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

    const VALID_CATEGORIES = ['student', 'parent', 'teacher', 'vip', 'guest'];

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
      };
    } else {
      // No header: assume positional — name, category, dietary, table, phone, email
      dataLines = lines;
      colMap = { name: 0, cat: 1, dietary: 2, table: 3, phone: 4, email: 5 };
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
  const { name, category, dietary, table_number, phone, email } = req.body;

  if (!name || !name.trim()) return res.redirect('/admin');

  const guest = await db.addSingleGuest(event.id, {
    name, category, dietary_restrictions: dietary, table_number, phone, email,
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
  const header = 'Name,Category,Table,Dietary,Phone,Email,Checked In,Checked In At\n';
  const rows = guests.map(g =>
    [
      `"${(g.name || '').replace(/"/g, '""')}"`,
      g.category || '',
      g.table_number || '',
      `"${(g.dietary_restrictions || '').replace(/"/g, '""')}"`,
      g.phone || '',
      g.email || '',
      g.checked_in ? 'Yes' : 'No',
      g.checked_in_at ? new Date(g.checked_in_at).toLocaleString() : '',
    ].join(',')
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="guests.csv"');
  res.send(header + rows);
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

// ── Reset (delete all guests) ──
router.post('/admin/reset', requireAdmin, async (req, res) => {
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
router.post('/admin/event', requireAdmin, async (req, res) => {
  const event = await db.getActiveEvent();
  if (!event) return res.redirect('/admin');

  await db.updateEvent(event.id, {
    name: req.body.event_name || event.name,
    event_date: req.body.event_date || event.event_date,
    event_time: req.body.event_time || event.event_time,
    venue: req.body.venue || event.venue,
  });
  res.redirect('/admin');
});

// ── User Management ──
router.get('/admin/users', requireAdmin, async (req, res) => {
  const users = await db.getAllUsers();
  res.send(renderUsersPage(users, req.session.user));
});

router.post('/admin/users/create', requireAdmin, async (req, res) => {
  const { username, password, display_name, role } = req.body;
  if (!username || !password || !display_name) return res.redirect('/admin/users');

  const existing = await db.getUserByUsername(username.trim().toLowerCase());
  if (existing) return res.redirect('/admin/users');

  const hash = await bcrypt.hash(password, 12);
  await db.createUser({
    username: username.trim().toLowerCase(),
    password_hash: hash,
    display_name: display_name.trim(),
    role: role === 'admin' ? 'admin' : 'volunteer',
    created_by: req.session.user.id,
  });

  res.redirect('/admin/users');
});

router.post('/admin/users/:id/toggle', requireAdmin, async (req, res) => {
  const user = await db.getUserById(Number(req.params.id));
  if (user && user.id !== req.session.user.id) {
    await db.updateUserActive(user.id, !user.is_active);
  }
  res.redirect('/admin/users');
});

// ── Kiosk Mode ──
router.get('/kiosk', (req, res) => {
  res.send(renderKiosk());
});

// ── Render Functions ──

function renderNav(user) {
  const adminLinks = user.role === 'admin' ? `
    <a href="/admin/users" class="nav-link">Users</a>
    <a href="/admin/export-csv" class="nav-link">CSV Export</a>
  ` : '';

  return `<nav class="navbar">
    <div class="nav-brand">&#9770; Iftar Check-in</div>
    <div class="nav-links">
      <a href="/admin" class="nav-link">Dashboard</a>
      ${adminLinks}
      <a href="/kiosk" class="nav-link" target="_blank">Kiosk</a>
      <span class="nav-user">${escapeHtml(user.display_name)} (${user.role})</span>
      <a href="/logout" class="nav-link nav-logout">Logout</a>
    </div>
  </nav>`;
}

function renderDashboard(event, user) {
  const isAdmin = user.role === 'admin';

  const addGuestSection = isAdmin ? `
    <div class="card">
      <h2>Add Guest</h2>
      <form method="POST" action="/admin/guest/add" class="guest-add-form">
        <div class="form-row">
          <input type="text" name="name" placeholder="Guest Name *" required>
          <select name="category">
            <option value="guest">Guest</option>
            <option value="student">Student</option>
            <option value="parent">Parent</option>
            <option value="teacher">Teacher</option>
            <option value="vip">VIP</option>
          </select>
          <input type="text" name="table_number" placeholder="Table #">
        </div>
        <div class="form-row" style="margin-top:10px">
          <input type="text" name="dietary" placeholder="Dietary restrictions">
          <input type="text" name="phone" placeholder="Phone">
          <input type="text" name="email" placeholder="Email">
          <button type="submit" class="btn btn-primary">Add Guest</button>
        </div>
      </form>
    </div>` : '';

  const importSection = isAdmin ? `
    <div class="card">
      <h2>Bulk Import</h2>
      <form method="POST" action="/admin/import" enctype="multipart/form-data">
        <textarea name="names" placeholder="Paste guest names, one per line..." rows="3"></textarea>
        <p class="muted" style="font-size:0.8rem;margin:6px 0">Or upload a CSV with columns: name, category, dietary, table, phone, email</p>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Import Names</button>
          <label class="btn btn-secondary file-upload">
            Upload CSV
            <input type="file" name="csv" accept=".csv,.txt" hidden onchange="this.form.submit()">
          </label>
          <a href="/admin/export-pdf" class="btn btn-gold">Download Tickets PDF</a>
        </div>
      </form>
    </div>` : '';

  const eventSettings = isAdmin ? `
    <div class="card">
      <h2>Event Settings</h2>
      <form method="POST" action="/admin/event" class="event-form">
        <div class="form-row">
          <input type="text" name="event_name" value="${escapeHtml(event.name)}" placeholder="Event Name">
          <input type="text" name="event_date" value="${escapeHtml(event.event_date)}" placeholder="Date">
          <input type="text" name="event_time" value="${escapeHtml(event.event_time)}" placeholder="Time">
          <input type="text" name="venue" value="${escapeHtml(event.venue)}" placeholder="Venue">
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>
    </div>` : '';

  const dangerZone = isAdmin ? `
    <div class="card card-danger">
      <h2>Danger Zone</h2>
      <form method="POST" action="/admin/reset" id="reset-form">
        <button type="submit" class="btn btn-danger">Clear All Guests</button>
      </form>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(event.name)} — Dashboard</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  ${renderNav(user)}
  <div class="container">
    <h1>${escapeHtml(event.name)}</h1>
    <p class="event-info">${escapeHtml(event.event_date)} at ${escapeHtml(event.event_time)} — ${escapeHtml(event.venue)}</p>

    <!-- Stats Cards -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-number" id="stat-total">-</div>
        <div class="stat-label">Total Guests</div>
      </div>
      <div class="stat-card stat-checked">
        <div class="stat-number" id="stat-checked">-</div>
        <div class="stat-label">Checked In</div>
      </div>
      <div class="stat-card stat-pending">
        <div class="stat-number" id="stat-pending">-</div>
        <div class="stat-label">Pending</div>
      </div>
      <div class="stat-card stat-percent">
        <div class="stat-number" id="stat-percent">-</div>
        <div class="stat-label">Progress</div>
        <div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
      </div>
    </div>

    <!-- Activity Feed + Chart -->
    <div class="dashboard-grid">
      <div class="card">
        <h2>Live Activity</h2>
        <div id="activity-feed" class="activity-feed">
          <p class="muted">Waiting for activity...</p>
        </div>
      </div>
      <div class="card">
        <h2>Check-in Timeline</h2>
        <canvas id="timeline-chart" width="400" height="200"></canvas>
      </div>
    </div>

    ${addGuestSection}
    ${importSection}
    ${eventSettings}

    <!-- Guest List -->
    <div class="card">
      <h2>Guest List</h2>
      <input type="text" class="search-box" id="search" placeholder="Search guests...">
      <div class="table-wrapper">
        <table class="guest-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Table</th>
              <th>Dietary</th>
              <th>Status</th>
              <th>Time</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="guest-list"></tbody>
        </table>
      </div>
    </div>

    ${dangerZone}
  </div>

  <script src="/dashboard.js"></script>
  <script>
    document.getElementById('reset-form')?.addEventListener('submit', function(e) {
      if (!confirm('This will DELETE ALL guests. Are you sure?')) e.preventDefault();
    });
  </script>
</body>
</html>`;
}

function renderUsersPage(users, currentUser) {
  const rows = users.map(u => `
    <tr class="${u.is_active ? '' : 'row-inactive'}">
      <td>${escapeHtml(u.display_name)}</td>
      <td>${escapeHtml(u.username)}</td>
      <td><span class="role-badge role-${u.role}">${u.role}</span></td>
      <td><span class="badge ${u.is_active ? 'badge-checked' : 'badge-inactive'}">${u.is_active ? 'Active' : 'Inactive'}</span></td>
      <td>${u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</td>
      <td>
        ${u.id !== currentUser.id ? `
          <form method="POST" action="/admin/users/${u.id}/toggle" style="display:inline">
            <button type="submit" class="btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-primary'}">
              ${u.is_active ? 'Deactivate' : 'Activate'}
            </button>
          </form>
        ` : '<span class="muted">You</span>'}
      </td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>User Management</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  ${renderNav(currentUser)}
  <div class="container">
    <h1>User Management</h1>

    <div class="card">
      <h2>Create New User</h2>
      <form method="POST" action="/admin/users/create" class="user-form">
        <div class="form-row">
          <input type="text" name="username" placeholder="Username" required>
          <input type="password" name="password" placeholder="Password" required>
          <input type="text" name="display_name" placeholder="Display Name" required>
          <select name="role">
            <option value="volunteer">Volunteer</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" class="btn btn-primary">Create</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h2>All Users</h2>
      <div class="table-wrapper">
        <table class="guest-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last Login</th>
              <th>Actions</th>
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
    <h1 class="kiosk-title">&#9770; Iftar Check-in</h1>
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

module.exports = router;
