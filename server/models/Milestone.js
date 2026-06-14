const mongoose = require('mongoose');

const milestoneSchema = new mongoose.Schema({
  judul:        { type: String, required: true, maxlength: 200, trim: true },
  deskripsi:    { type: String, default: '' },
  tanggal:      { type: Date, required: true },
  status:       { type: String, enum: ['pending','tercapai'], default: 'pending' },
  direktoratId: { type: mongoose.Schema.Types.ObjectId, ref: 'Direktorat', default: null },
  taskIds:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'Task' }],
  warna:        { type: String, default: '#6366F1' },
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

milestoneSchema.index({ tanggal: 1 });

module.exports = mongoose.model('Milestone', milestoneSchema);
