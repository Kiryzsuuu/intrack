const mongoose = require('mongoose');

const kpiSnapshotSchema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  periodeBulan:  { type: Number, required: true, min: 1, max: 12 },
  periodeTahun:  { type: Number, required: true },
  skorTotal:     { type: Number, default: 0 },
  skorWaktu:     { type: Number, default: 0 },
  skorVolume:    { type: Number, default: 0 },
  skorKualitas:  { type: Number, default: 0 },
  targetKpi:     { type: Number, default: 70 },
  totalDone:     { type: Number, default: 0 },
  totalAssigned: { type: Number, default: 0 },
  totalTepat:    { type: Number, default: 0 },
  totalRevisi:   { type: Number, default: 0 },
  isKalibrasi:   { type: Boolean, default: false },
}, { timestamps: true });

kpiSnapshotSchema.index({ userId: 1, periodeTahun: 1, periodeBulan: 1 }, { unique: true });

module.exports = mongoose.model('KpiSnapshot', kpiSnapshotSchema);
