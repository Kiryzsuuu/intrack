// Hirarki akses: superadmin > komisaris > direksi > manager > staff
const ROLE_LEVEL = { superadmin: 5, komisaris: 4, direksi: 3, manager: 2, staff: 1 };

function requireRole(...roles) {
  return (req, res, next) => {
    if (req.user.role === 'superadmin' || roles.includes(req.user.role)) return next();
    return res.status(403).json({ message: 'Akses ditolak: hak akses tidak mencukupi' });
  };
}

function requireSuperadmin(req, res, next) {
  if (req.user.role !== 'superadmin')
    return res.status(403).json({ message: 'Akses ditolak: hanya superadmin' });
  next();
}

// Minimal level direksi ke atas (komisaris, direksi, superadmin)
function requireDireksiUp(req, res, next) {
  const level = ROLE_LEVEL[req.user.role] || 0;
  if (level >= 3) return next();
  return res.status(403).json({ message: 'Akses ditolak: hanya Direksi ke atas' });
}

module.exports = { requireRole, requireSuperadmin, requireDireksiUp, ROLE_LEVEL };
