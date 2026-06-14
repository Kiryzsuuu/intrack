const router       = require('express').Router();
const path         = require('path');
const fs           = require('fs');
const multer       = require('multer');
const auth         = require('../middleware/auth');
const { requireSuperadmin } = require('../middleware/roles');
const SiteSettings = require('../models/SiteSettings');

const logoStorage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(__dirname, '../../public/img');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, 'logo' + ext);
  },
});
const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (/image\/(png|jpeg|jpg|svg\+xml|webp)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Hanya file gambar yang diizinkan'));
  },
});

async function getSettings() {
  let s = await SiteSettings.findOne();
  if (!s) s = await SiteSettings.create({});
  return s;
}

// GET /api/site-settings — publik
router.get('/', async (req, res) => {
  const s = await getSettings();
  res.json(s);
});

// PUT /api/site-settings — superadmin
router.put('/', auth, requireSuperadmin, async (req, res) => {
  const {
    appName, accentColor,
    heroLine1, heroLine2, heroSub, loginFeatures,
    loginTitle, loginSubtitle,
  } = req.body;

  const s = await getSettings();
  if (appName      !== undefined) s.appName      = appName;
  if (accentColor  !== undefined) s.accentColor  = accentColor;
  if (heroLine1    !== undefined) s.heroLine1    = heroLine1;
  if (heroLine2    !== undefined) s.heroLine2    = heroLine2;
  if (heroSub      !== undefined) s.heroSub      = heroSub;
  if (loginTitle   !== undefined) s.loginTitle   = loginTitle;
  if (loginSubtitle!== undefined) s.loginSubtitle= loginSubtitle;
  if (Array.isArray(loginFeatures)) s.loginFeatures = loginFeatures;

  await s.save();
  res.json({ message: 'Pengaturan disimpan', settings: s });
});

// POST /api/site-settings/logo — upload logo
router.post('/logo', auth, requireSuperadmin, uploadLogo.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'File tidak ditemukan' });
  const logoUrl = '/img/' + req.file.filename;
  const s = await getSettings();
  s.appLogo = logoUrl;
  await s.save();
  res.json({ message: 'Logo diperbarui', logoUrl, settings: s });
});

module.exports = router;
