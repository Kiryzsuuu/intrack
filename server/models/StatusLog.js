const mongoose = require('mongoose');

const statusLogSchema = new mongoose.Schema({
  taskId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  statusLama: { type: String },
  statusBaru: { type: String, required: true },
  catatan:    { type: String, default: null },
}, { timestamps: true });

statusLogSchema.index({ taskId: 1, createdAt: 1 });

module.exports = mongoose.model('StatusLog', statusLogSchema);
