function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    res.locals.user = req.session.user;
    return next();
  }
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    res.locals.user = req.session.user;
    return next();
  }
  res.status(403).send('Access denied. Admin only.');
}

function requireVolunteer(req, res, next) {
  if (req.session && req.session.user) {
    res.locals.user = req.session.user;
    return next();
  }
  res.redirect('/login');
}

module.exports = { requireAuth, requireAdmin, requireVolunteer };
