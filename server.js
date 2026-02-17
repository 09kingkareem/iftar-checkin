require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const http = require('http');
const { WebSocketServer } = require('ws');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ── Middleware ──
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Sessions ──
const sessionMiddleware = session({
  store: new PgSession({
    pool: db.pool,
    tableName: 'session',
    createTableIfMissing: false,
  }),
  secret: process.env.SESSION_SECRET || 'iftar-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    sameSite: 'lax',
  },
});
app.use(sessionMiddleware);

// ── WebSocket ──
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

// Heartbeat to clean dead connections
const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

// Broadcast function available to routes
app.locals.broadcast = function(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
};

// ── Language Middleware ──
app.use((req, res, next) => {
  if (req.query.lang && ['en', 'ar'].includes(req.query.lang)) {
    req.session.lang = req.query.lang;
  }
  const lang = req.session.lang || 'en';
  res.locals.lang = lang;
  res.locals.dir = lang === 'ar' ? 'rtl' : 'ltr';
  next();
});

// ── Routes ──
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/admin'));
app.use('/', require('./routes/checkin'));
app.use('/', require('./routes/api'));

// Root redirect
app.get('/', (req, res) => {
  res.redirect(req.session && req.session.user ? '/admin' : '/login');
});

// ── Start ──
async function start() {
  await db.init();
  server.listen(PORT, () => {
    console.log(`Iftar Check-in running at http://localhost:${PORT}`);
    console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
    console.log(`Kiosk mode: http://localhost:${PORT}/kiosk`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
