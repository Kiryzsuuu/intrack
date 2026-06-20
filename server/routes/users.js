const router      = require('express').Router();
const crypto      = require('crypto');
const User        = require('../models/User');
const auth        = require('../middleware/auth');
const { requireRole, requireSuperadmin } = require('../middleware/roles');
const { uploadAvatar } = require('../middleware/upload');
const { mailPasswordReset } = require('../services/mailer');
const audit = require('../services/audit');

// GET /api/users — Direksi/Superadmin: semua user; Manager: tidak bisa
router.get('/', auth, requireRole('direksi'), async (req, res) => {
  const { direktoratId, role, search, limit } = req.query;
  const filter = {};
  if (direktoratId) filter.direktoratId = direktoratId;
  if (role) filter.role = role;
  if (search) filter.namaLengkap = { $regex: search, $options: 'i' };

  let q = User.find(filter)
    .populate('direktoratId', 'nama kode')
    .select('-passwordHash')
    .sort({ namaLengkap: 1 });
  if (limit) q = q.limit(parseInt(limit));

  const users = await q;
  res.json(users);
});

// GET /api/users/selectable — daftar user aktif untuk dipilih sebagai assignee (semua user login)
router.get('/selectable', auth, async (req, res) => {
  const { search } = req.query;
  const filter = { statusAktif: true };
  if (search) filter.namaLengkap = { $regex: search, $options: 'i' };
  const users = await User.find(filter)
    .select('namaLengkap email fotoProfil role direktoratId statusAktif')
    .populate('direktoratId', 'nama kode')
    .sort({ namaLengkap: 1 });
  res.json(users);
});

// GET /api/users/mention — autocomplete @mention, semua authenticated user bisa akses
router.get('/mention', auth, async (req, res) => {
  const { q } = req.query;
  const filter = { statusAktif: true };
  if (q) filter.namaLengkap = { $regex: q, $options: 'i' };
  const users = await User.find(filter)
    .select('namaLengkap email fotoProfil role direktoratId')
    .populate('direktoratId', 'kode')
    .sort({ namaLengkap: 1 })
    .limit(10);
  res.json(users);
});

// GET /api/users/managers-direktorat/:id — manager dalam direktorat tertentu
router.get('/managers-direktorat/:id', auth, async (req, res) => {
  // Manager hanya bisa lihat direktorat sendiri
  if (req.user.role === 'manager') {
    const userDirId = req.user.direktoratId?._id?.toString() || req.user.direktoratId?.toString();
    if (userDirId !== req.params.id) {
      return res.status(403).json({ message: 'Akses ditolak' });
    }
  }
  const users = await User.find({ direktoratId: req.params.id, role: 'manager', statusAktif: true })
    .select('-passwordHash')
    .sort({ namaLengkap: 1 });
  res.json(users);
});

// POST /api/users — Direksi/Superadmin buat user baru
router.post('/', auth, requireRole('direksi'), async (req, res) => {
  const { namaLengkap, email, role, direktoratId, nomorWa } = req.body;
  if (!namaLengkap || !email || !role)
    return res.status(400).json({ message: 'Nama, email, dan role wajib diisi' });

  // Hanya superadmin yang bisa buat superadmin/direksi baru
  if (['superadmin', 'direksi'].includes(role) && req.user.role !== 'superadmin')
    return res.status(403).json({ message: 'Hanya superadmin yang bisa membuat akun direksi/superadmin' });

  if (role === 'manager' && !direktoratId)
    return res.status(400).json({ message: 'Manager wajib memiliki direktorat' });

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return res.status(400).json({ message: 'Email sudah terdaftar' });

  const tempPassword = crypto.randomBytes(6).toString('hex');
  const user = await User.create({
    namaLengkap,
    email,
    passwordHash: tempPassword,
    role,
    direktoratId: role === 'direksi' ? null : direktoratId,
    nomorWa: nomorWa || null,
    isFirstLogin: true,
  });

  await mailPasswordReset(user, tempPassword);

  audit.log(req, 'user.create', { target:'User', targetId: user._id, detail: { email, role } });
  res.status(201).json({ message: 'User berhasil dibuat, password dikirim via email', user: user.toPublic() });
});

// PUT /api/users/me — shortcut untuk edit profil sendiri
router.put('/me', auth, async (req, res) => {
  const user = req.user;
  if (req.body.namaLengkap !== undefined) user.namaLengkap = req.body.namaLengkap;
  if (req.body.notifEmail  !== undefined) user.notifEmail  = req.body.notifEmail;
  if (req.body.notifWa     !== undefined) user.notifWa     = req.body.notifWa;
  if (req.body.nomorWa     !== undefined) user.nomorWa     = req.body.nomorWa;
  await user.save();
  res.json({ message: 'Profil diupdate', user: user.toPublic() });
});

// GET /api/users/:id
router.get('/:id', auth, async (req, res) => {
  const user = await User.findById(req.params.id).populate('direktoratId', 'nama kode').select('-passwordHash');
  if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });
  res.json(user);
});

// PUT /api/users/:id — Direksi edit user, atau user edit diri sendiri (profil)
router.put('/:id', auth, async (req, res) => {
  const isSelf = req.user._id.toString() === req.params.id;
  const isDireksi = req.user.role === 'direksi';
  const isSuperadmin = req.user.role === 'superadmin';
  if (!isSelf && !isDireksi && !isSuperadmin)
    return res.status(403).json({ message: 'Akses ditolak' });

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });

  // Superadmin tidak bisa diedit oleh selain superadmin
  if (user.role === 'superadmin' && !isSuperadmin)
    return res.status(403).json({ message: 'Akses ditolak' });

  if (isSelf) {
    // User bisa update profil sendiri
    if (req.body.namaLengkap) user.namaLengkap = req.body.namaLengkap;
    if (req.body.notifEmail !== undefined) user.notifEmail = req.body.notifEmail;
    if (req.body.notifWa    !== undefined) user.notifWa    = req.body.notifWa;
    if (req.body.nomorWa    !== undefined) user.nomorWa    = req.body.nomorWa;
  }

  if (isDireksi || isSuperadmin) {
    // Direksi/Superadmin bisa update field umum
    if (req.body.namaLengkap !== undefined) user.namaLengkap = req.body.namaLengkap;
    if (req.body.email       !== undefined) user.email       = req.body.email;
    if (req.body.direktoratId!== undefined) user.direktoratId= req.body.direktoratId;
    if (req.body.statusAktif !== undefined) user.statusAktif = req.body.statusAktif;
    if (req.body.nomorWa     !== undefined) user.nomorWa     = req.body.nomorWa;
    // Hanya superadmin yang bisa ganti role
    if (req.body.role !== undefined) {
      if (req.user.role !== 'superadmin')
        return res.status(403).json({ message: 'Hanya superadmin yang bisa mengubah role' });
      user.role = req.body.role;
    }
  }

  await user.save();
  res.json({ message: 'User berhasil diupdate', user: user.toPublic() });
});

// POST /api/users/:id/reset-password — Direksi/Superadmin reset password
router.post('/:id/reset-password', auth, requireRole('direksi'), async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });

  const newPassword = req.body.passwordBaru || crypto.randomBytes(6).toString('hex');
  user.passwordHash = newPassword;
  user.isFirstLogin = true;
  await user.save();

  if (!req.body.passwordBaru) await mailPasswordReset(user, newPassword);
  audit.log(req, 'user.reset_password', { target:'User', targetId: user._id, detail: { email: user.email } });
  res.json({ message: 'Password berhasil direset' });
});

// DELETE /api/users/:id — hanya superadmin
router.delete('/:id', auth, requireSuperadmin, async (req, res) => {
  if (req.user._id.toString() === req.params.id)
    return res.status(400).json({ message: 'Tidak bisa menghapus akun sendiri' });
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });
  audit.log(req, 'user.delete', { target:'User', targetId: user._id, detail: { email: user.email, role: user.role } });
  res.json({ message: `User ${user.email} berhasil dihapus` });
});

// POST /api/users/me/avatar — Upload foto profil (base64)
router.post('/me/avatar', auth, async (req, res) => {
  const { base64 } = req.body;
  if (!base64) return res.status(400).json({ message: 'Data foto tidak ditemukan' });
  // Validasi format
  if (!base64.startsWith('data:image/')) return res.status(400).json({ message: 'Format tidak valid, harus image' });
  // Validasi ukuran (max ~2MB base64 ≈ 1.5MB asli)
  if (base64.length > 2.8 * 1024 * 1024) return res.status(400).json({ message: 'Ukuran foto maksimal 2MB' });
  req.user.fotoProfil = base64;
  await req.user.save();
  res.json({ message: 'Foto profil diupdate', user: req.user.toPublic() });
});

module.exports = router;
