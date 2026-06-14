const router          = require('express').Router();
const auth            = require('../middleware/auth');
const PushSubscription = require('../models/PushSubscription');

// GET /api/push/vapid-public-key — frontend ambil public key untuk subscribe
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe — simpan subscription dari browser
router.post('/subscribe', auth, async (req, res) => {
  const { subscription } = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ message: 'Subscription tidak valid' });

  await PushSubscription.findOneAndUpdate(
    { 'subscription.endpoint': subscription.endpoint },
    { userId: req.user._id, subscription, userAgent: req.headers['user-agent'] || '' },
    { upsert: true, new: true }
  );
  res.json({ message: 'Push subscription tersimpan' });
});

// DELETE /api/push/subscribe — unsubscribe
router.delete('/subscribe', auth, async (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) {
    await PushSubscription.deleteOne({ 'subscription.endpoint': endpoint, userId: req.user._id });
  } else {
    // Hapus semua subscription user ini
    await PushSubscription.deleteMany({ userId: req.user._id });
  }
  res.json({ message: 'Unsubscribed' });
});

module.exports = router;
