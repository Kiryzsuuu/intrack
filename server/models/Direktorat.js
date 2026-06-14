const mongoose = require('mongoose');

const direktoratSchema = new mongoose.Schema({
  nama: { type: String, required: true, trim: true },
  kode: { type: String, required: true, unique: true, trim: true, uppercase: true },
}, { timestamps: true });

module.exports = mongoose.model('Direktorat', direktoratSchema);
