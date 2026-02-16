const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com') ? { rejectUnauthorized: false } : false,
});

// ── Initialization ──
async function init() {
  const { migrate } = require('./migrate');
  await migrate(pool);
}

// ── Events ──
async function getActiveEvent() {
  const { rows } = await pool.query(
    'SELECT * FROM events WHERE is_active = true ORDER BY id LIMIT 1'
  );
  return rows[0] || null;
}

async function updateEvent(id, { name, event_date, event_time, venue }) {
  await pool.query(
    'UPDATE events SET name=$1, event_date=$2, event_time=$3, venue=$4 WHERE id=$5',
    [name, event_date, event_time, venue, id]
  );
}

// ── Users ──
async function getUserByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return rows[0] || null;
}

async function getUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getAllUsers() {
  const { rows } = await pool.query(
    'SELECT id, username, email, display_name, role, is_active, last_login, created_at FROM users ORDER BY created_at'
  );
  return rows;
}

async function createUser({ username, email, password_hash, display_name, role, created_by }) {
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, password_hash, display_name, role, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [username, email || null, password_hash, display_name, role || 'volunteer', created_by]
  );
  return rows[0].id;
}

async function updateUserActive(id, is_active) {
  await pool.query('UPDATE users SET is_active = $1 WHERE id = $2', [is_active, id]);
}

async function updateLastLogin(id) {
  await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [id]);
}

// ── Guests ──
async function addGuests(names, eventId, extraFields = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const name of names) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const token = require('crypto').randomBytes(9).toString('base64url').slice(0, 12);
      await client.query(
        `INSERT INTO guests (event_id, name, token, category, dietary_restrictions, table_number, phone, email)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          eventId, trimmed, token,
          extraFields.category || 'guest',
          extraFields.dietary || null,
          extraFields.table_number || null,
          extraFields.phone || null,
          extraFields.email || null,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function addGuestsBulk(guestRows, eventId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const g of guestRows) {
      const name = (g.name || '').trim();
      if (!name) continue;
      const token = require('crypto').randomBytes(9).toString('base64url').slice(0, 12);
      await client.query(
        `INSERT INTO guests (event_id, name, token, category, dietary_restrictions, table_number, phone, email)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          eventId, name, token,
          g.category || 'guest',
          g.dietary || g.dietary_restrictions || null,
          g.table_number || g.table || null,
          g.phone || null,
          g.email || null,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function getAllGuests(eventId) {
  const { rows } = await pool.query(
    'SELECT * FROM guests WHERE event_id = $1 ORDER BY name', [eventId]
  );
  return rows;
}

async function getGuestByToken(token) {
  const { rows } = await pool.query('SELECT * FROM guests WHERE token = $1', [token]);
  return rows[0] || null;
}

async function getGuestById(id) {
  const { rows } = await pool.query('SELECT * FROM guests WHERE id = $1', [id]);
  return rows[0] || null;
}

async function checkInGuest(id, userId) {
  await pool.query(
    `UPDATE guests SET checked_in = true, checked_in_at = NOW(), checked_in_by = $1,
     scan_count = scan_count + 1, last_scanned_at = NOW() WHERE id = $2`,
    [userId, id]
  );
}

async function incrementScanCount(id) {
  await pool.query(
    'UPDATE guests SET scan_count = scan_count + 1, last_scanned_at = NOW() WHERE id = $1',
    [id]
  );
}

async function searchGuests(query, eventId) {
  const { rows } = await pool.query(
    "SELECT * FROM guests WHERE event_id = $1 AND name ILIKE $2 ORDER BY name",
    [eventId, `%${query}%`]
  );
  return rows;
}

async function getStats(eventId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE checked_in = true) as checked_in FROM guests WHERE event_id = $1',
    [eventId]
  );
  return { total: parseInt(rows[0].total) || 0, checkedIn: parseInt(rows[0].checked_in) || 0 };
}

async function deleteAllGuests(eventId) {
  await pool.query('DELETE FROM guests WHERE event_id = $1', [eventId]);
}

// ── Activity Log ──
async function logActivity(eventId, action, { guestId, userId, details } = {}) {
  await pool.query(
    'INSERT INTO activity_log (event_id, action, guest_id, user_id, details) VALUES ($1, $2, $3, $4, $5)',
    [eventId, action, guestId || null, userId || null, details || null]
  );
}

async function getRecentActivity(eventId, limit = 50) {
  const { rows } = await pool.query(
    `SELECT al.*, g.name as guest_name, u.display_name as user_name
     FROM activity_log al
     LEFT JOIN guests g ON al.guest_id = g.id
     LEFT JOIN users u ON al.user_id = u.id
     WHERE al.event_id = $1
     ORDER BY al.created_at DESC LIMIT $2`,
    [eventId, limit]
  );
  return rows;
}

async function getCheckinTimeline(eventId) {
  const { rows } = await pool.query(
    `SELECT date_trunc('minute', checked_in_at) as minute, COUNT(*) as count
     FROM guests WHERE event_id = $1 AND checked_in = true
     GROUP BY minute ORDER BY minute`,
    [eventId]
  );
  return rows;
}

module.exports = {
  pool,
  init,
  getActiveEvent, updateEvent,
  getUserByUsername, getUserById, getAllUsers, createUser, updateUserActive, updateLastLogin,
  addGuests, addGuestsBulk, getAllGuests, getGuestByToken, getGuestById,
  checkInGuest, incrementScanCount, searchGuests, getStats, deleteAllGuests,
  logActivity, getRecentActivity, getCheckinTimeline,
};
