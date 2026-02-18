const bcrypt = require('bcrypt');

async function migrate(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'School Iftar 2026',
      event_date TEXT DEFAULT '2026-03-15',
      event_time TEXT DEFAULT '6:30 PM',
      venue TEXT DEFAULT 'School Hall',
      description TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'volunteer' CHECK (role IN ('superadmin', 'admin', 'volunteer')),
      is_active BOOLEAN DEFAULT true,
      last_login TIMESTAMPTZ,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS guests (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      category TEXT DEFAULT 'guest' CHECK (category IN ('student', 'parent', 'teacher', 'vip', 'guest', 'family')),
      family_size INTEGER DEFAULT 1,
      dietary_restrictions TEXT,
      table_number TEXT,
      phone TEXT,
      email TEXT,
      notes TEXT,
      checked_in BOOLEAN DEFAULT false,
      checked_in_at TIMESTAMPTZ,
      checked_in_by INTEGER REFERENCES users(id),
      scan_count INTEGER DEFAULT 0,
      last_scanned_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      details TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS session (
      sid VARCHAR NOT NULL PRIMARY KEY,
      sess JSON NOT NULL,
      expire TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);
    CREATE INDEX IF NOT EXISTS idx_guests_token ON guests (token);
    CREATE INDEX IF NOT EXISTS idx_guests_event ON guests (event_id);
    CREATE INDEX IF NOT EXISTS idx_activity_event ON activity_log (event_id);

    CREATE TABLE IF NOT EXISTS announcements (
      id SERIAL PRIMARY KEY,
      event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      type TEXT DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning')),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      dismissed_at TIMESTAMPTZ
    );
  `);

  // Seed default event if none exists
  const { rows: events } = await pool.query('SELECT id FROM events LIMIT 1');
  if (events.length === 0) {
    await pool.query(
      `INSERT INTO events (name, event_date, event_time, venue) VALUES ($1, $2, $3, $4)`,
      ['School Iftar 2026', '2026-03-15', '6:30 PM', 'School Hall']
    );
  }

  // Seed default admin if none exists
  const { rows: admins } = await pool.query("SELECT id FROM users WHERE role IN ('admin', 'superadmin') LIMIT 1");
  if (admins.length === 0) {
    const hash = await bcrypt.hash('admin123', 12);
    await pool.query(
      `INSERT INTO users (username, password_hash, display_name, role) VALUES ($1, $2, $3, $4)`,
      ['admin', hash, 'Administrator', 'superadmin']
    );
    console.log('Default admin created — username: admin, password: admin123 (superadmin)');
  }

  // Auto-migrate: update role constraint to include superadmin
  try {
    await pool.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
      ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('superadmin', 'admin', 'volunteer'));
    `);
    console.log('Updated role constraint to include superadmin.');
  } catch (e) {
    // Constraint may already be correct
  }

  // Auto-migrate: upgrade existing default admin to superadmin
  await pool.query(`UPDATE users SET role = 'superadmin' WHERE username = 'admin' AND role = 'admin'`);

  // ── Auto-migrate existing databases: add family_size column + update category constraint ──
  const { rows: colCheck } = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'guests' AND column_name = 'family_size'
  `);
  if (colCheck.length === 0) {
    await pool.query('ALTER TABLE guests ADD COLUMN family_size INTEGER DEFAULT 1');
    console.log('Added family_size column to guests table.');
  }

  // Update category constraint to include 'family'
  try {
    await pool.query(`
      ALTER TABLE guests DROP CONSTRAINT IF EXISTS guests_category_check;
      ALTER TABLE guests ADD CONSTRAINT guests_category_check
        CHECK (category IN ('student', 'parent', 'teacher', 'vip', 'guest', 'family'));
    `);
    console.log('Updated category constraint to include family.');
  } catch (e) {
    // Constraint may already be correct — that's fine
  }

  // Auto-migrate: add feedback_url column to events
  const { rows: feedbackCol } = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'feedback_url'
  `);
  if (feedbackCol.length === 0) {
    await pool.query('ALTER TABLE events ADD COLUMN feedback_url TEXT');
    console.log('Added feedback_url column to events table.');
  }

  // Auto-migrate: add paid column to guests
  const { rows: paidCol } = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'guests' AND column_name = 'paid'
  `);
  if (paidCol.length === 0) {
    await pool.query('ALTER TABLE guests ADD COLUMN paid BOOLEAN DEFAULT false');
    console.log('Added paid column to guests table.');
  }

  // Auto-migrate: add Ziina payment columns to guests
  const { rows: paymentCol } = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'guests' AND column_name = 'payment_intent_id'
  `);
  if (paymentCol.length === 0) {
    await pool.query('ALTER TABLE guests ADD COLUMN payment_intent_id TEXT');
    await pool.query('ALTER TABLE guests ADD COLUMN payment_url TEXT');
    console.log('Added payment_intent_id and payment_url columns to guests table.');
  }

  // Auto-migrate: add badge_sent tracking columns to guests
  const { rows: badgeCol } = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'guests' AND column_name = 'badge_sent'
  `);
  if (badgeCol.length === 0) {
    await pool.query('ALTER TABLE guests ADD COLUMN badge_sent BOOLEAN DEFAULT false');
    await pool.query('ALTER TABLE guests ADD COLUMN badge_sent_at TIMESTAMPTZ');
    console.log('Added badge_sent and badge_sent_at columns to guests table.');
  }

  // Auto-migrate: add badge_active column to guests
  const { rows: badgeActiveCol } = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'guests' AND column_name = 'badge_active'
  `);
  if (badgeActiveCol.length === 0) {
    await pool.query('ALTER TABLE guests ADD COLUMN badge_active BOOLEAN DEFAULT true');
    console.log('Added badge_active column to guests table.');
  }

  console.log('Database migration complete.');
}

// Allow running standalone: node migrate.js
if (require.main === module) {
  require('dotenv').config();
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('render.com') ? { rejectUnauthorized: false } : false,
  });
  migrate(pool).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { migrate };
