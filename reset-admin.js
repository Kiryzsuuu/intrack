require('dotenv').config({ path: '.env', override: true });
require('dns').setDefaultResultOrder('ipv4first');
require('dns').setServers(['8.8.8.8', '1.1.1.1']);
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const User     = require('./server/models/User');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const hash = await bcrypt.hash('opet123', 12);
  await User.collection.updateOne(
    { email: 'maskiryz23@gmail.com' },
    { $set: { passwordHash: hash, isFirstLogin: false } }
  );
  console.log('Password reset to opet123 for maskiryz23@gmail.com (ENIK: 260403)');
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
