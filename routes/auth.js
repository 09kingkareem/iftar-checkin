const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/admin');
  res.send(renderLogin());
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.send(renderLogin('Please enter username and password.'));
  }

  const user = await db.getUserByUsername(username.trim().toLowerCase());
  if (!user || !user.is_active) {
    return res.send(renderLogin('Invalid credentials or account deactivated.'));
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.send(renderLogin('Invalid credentials.'));
  }

  await db.updateLastLogin(user.id);
  const event = await db.getActiveEvent();

  req.session.user = {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
  };

  if (event) {
    await db.logActivity(event.id, 'login', { userId: user.id, details: `${user.display_name} logged in` });
  }

  res.redirect('/admin');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

function renderLogin(error = '') {
  const errorHtml = error ? `<p class="error-msg">${error}</p>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iftar Check-in — Login</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="login-page">
    <div class="login-card">
      <div class="login-logo">&#9770;</div>
      <h1>Iftar Check-in</h1>
      <p class="login-subtitle">Sign in to continue</p>
      ${errorHtml}
      <form method="POST" action="/login">
        <input type="text" name="username" placeholder="Username" autocomplete="username" autofocus required>
        <input type="password" name="password" placeholder="Password" autocomplete="current-password" required>
        <button type="submit" class="btn btn-primary" style="width:100%">Sign In</button>
      </form>
    </div>
  </div>
</body>
</html>`;
}

module.exports = router;
