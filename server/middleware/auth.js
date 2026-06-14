const jwt  = require('jsonwebtoken');
const User = require('../models/User');

async function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token autentikasi diperlukan' });
  }
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).populate('direktoratId');
    if (!user || !user.statusAktif) {
      return res.status(401).json({ message: 'Akun tidak aktif atau tidak ditemukan' });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: 'Token tidak valid atau sudah kedaluwarsa' });
  }
}

module.exports = auth;
