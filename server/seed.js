require('dotenv').config({ path: require('path').join(__dirname, '../.env'), override: true });
require('dns').setDefaultResultOrder('ipv4first');
require('dns').setServers(['8.8.8.8', '1.1.1.1']);
const mongoose   = require('mongoose');
const bcrypt     = require('bcryptjs');
const Direktorat = require('./models/Direktorat');
const User       = require('./models/User');

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/worktrack');
  console.log('Connected to MongoDB');

  // Clear existing
  await Direktorat.deleteMany({});
  await User.deleteMany({});

  // Superadmin — gunakan insertOne agar bypass pre-save hook double-hash
  const hash = await bcrypt.hash('opet123', 12);
  await User.collection.insertOne({
    namaLengkap: 'Maskiryz',
    email: 'maskiryz23@gmail.com',
    passwordHash: hash,
    role: 'superadmin',
    isFirstLogin: false,
    statusAktif: true,
    direktoratId: null,
    notifEmail: true,
    notifWa: false,
    nomorWa: null,
    fotoProfil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log('  ✓ maskiryz23@gmail.com (superadmin)');


  // Direktorat
  await Direktorat.deleteMany({});
  console.log('Direktorat cleared');

  console.log('\n✅ Seed selesai!');
  console.log('\nLogin sebagai superadmin:');
  console.log('  Email   : maskiryz23@gmail.com');
  console.log('  Password: opet123');

  await mongoose.disconnect();
}

seed().catch(err => { console.error(err); process.exit(1); });
