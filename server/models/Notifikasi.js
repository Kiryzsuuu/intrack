const mongoose = require('mongoose');

const notifikasiSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  jenis:    { type: String, required: true },
  judul:    { type: String, required: true },
  isi:      { type: String, required: true },
  taskId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
  isRead:   { type: Boolean, default: false },
  readAt:   { type: Date, default: null },
}, { timestamps: true });

notifikasiSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

// Auto-delete setelah 90 hari
notifikasiSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.model('Notifikasi', notifikasiSchema);
