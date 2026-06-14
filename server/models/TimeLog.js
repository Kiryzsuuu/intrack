const mongoose = require('mongoose');

const timeLogSchema = new mongoose.Schema({
  taskId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  durasiMenit: { type: Number, required: true, min: 1 },
  catatan:   { type: String, default: '' },
  tanggal:   { type: Date, required: true, default: Date.now },
}, { timestamps: true });

timeLogSchema.index({ taskId: 1 });
timeLogSchema.index({ userId: 1, tanggal: -1 });

module.exports = mongoose.model('TimeLog', timeLogSchema);
