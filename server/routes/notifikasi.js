const router     = require('express').Router();
const Notifikasi = require('../models/Notifikasi');
const auth       = require('../middleware/auth');

// GET /api/notifikasi
router.get('/', auth, async (req, res) => {
  const { page = 1, limit = 30, jenis } = req.query;
  const filter = { userId: req.user._id };
  if (jenis) filter.jenis = jenis;
  const notifs = await Notifikasi.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const unreadCount = await Notifikasi.countDocuments({ userId: req.user._id, isRead: false });

  res.json({ notifikasi: notifs, unreadCount });
});

// PUT /api/notifikasi/:id/baca — tandai satu sebagai dibaca
router.put('/:id/baca', auth, async (req, res) => {
  await Notifikasi.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id },
    { isRead: true, readAt: new Date() }
  );
  res.json({ message: 'Ditandai dibaca' });
});

// PUT /api/notifikasi/baca-semua
router.put('/baca-semua/all', auth, async (req, res) => {
  await Notifikasi.updateMany(
    { userId: req.user._id, isRead: false },
    { isRead: true, readAt: new Date() }
  );
  res.json({ message: 'Semua notifikasi ditandai dibaca' });
});

module.exports = router;
