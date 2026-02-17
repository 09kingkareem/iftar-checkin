const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { t } = require('../i18n');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/admin');
  const lang = (res.locals && res.locals.lang) || 'en';
  const dir = (res.locals && res.locals.dir) || 'ltr';
  res.send(renderLogin('', lang, dir));
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const lang = (res.locals && res.locals.lang) || 'en';
  const dir = (res.locals && res.locals.dir) || 'ltr';

  if (!username || !password) {
    return res.send(renderLogin('Please enter username and password.', lang, dir));
  }

  const user = await db.getUserByUsername(username.trim().toLowerCase());
  if (!user || !user.is_active) {
    return res.send(renderLogin('Invalid credentials or account deactivated.', lang, dir));
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.send(renderLogin('Invalid credentials.', lang, dir));
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

function renderLogin(error = '', lang = 'en', dir = 'ltr') {
  const L = (key) => t(lang, key);
  const errorHtml = error ? `<p class="error-msg">${error}</p>` : '';
  const langToggle = lang === 'ar'
    ? '<a href="?lang=en" style="color:var(--gold);font-size:0.85rem;margin-top:12px;display:block">English</a>'
    : '<a href="?lang=ar" style="color:var(--gold);font-size:0.85rem;margin-top:12px;display:block">عربي</a>';
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${L('login.title')}</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="login-page">
    <div class="login-card">
      <div class="login-logo">&#9770;</div>
      <h1>${L('login.title')}</h1>
      <p class="login-subtitle">${L('login.subtitle')}</p>
      ${errorHtml}
      <form method="POST" action="/login">
        <input type="text" name="username" placeholder="${L('login.username')}" autocomplete="username" autofocus required>
        <input type="password" name="password" placeholder="${L('login.password')}" autocomplete="current-password" required>
        <button type="submit" class="btn btn-primary" style="width:100%">${L('login.submit')}</button>
      </form>
      ${langToggle}
    </div>
  </div>
</body>
</html>`;
}

module.exports = router;
