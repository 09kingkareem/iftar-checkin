function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    res.locals.user = req.session.user;
    return next();
  }
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'superadmin')) {
    res.locals.user = req.session.user;
    return next();
  }
  res.status(403).send('Access denied. Admin only.');
}

function requireSuperAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'superadmin') {
    res.locals.user = req.session.user;
    return next();
  }
  res.status(403).send('Access denied. Super Admin only.');
}

function requireVolunteer(req, res, next) {
  if (req.session && req.session.user) {
    res.locals.user = req.session.user;
    return next();
  }
  res.redirect('/login');
}

function isAdmin(user) {
  return user && (user.role === 'admin' || user.role === 'superadmin');
}

function isSuperAdmin(user) {
  return user && user.role === 'superadmin';
}

module.exports = { requireAuth, requireAdmin, requireSuperAdmin, requireVolunteer, isAdmin, isSuperAdmin };
