const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  aksi:     { type: String, required: true }, // e.g. 'task.approve', 'user.create'
  target:   { type: String, default: '' },    // model name: 'Task', 'User', etc.
  targetId: { type: mongoose.Schema.Types.ObjectId, default: null },
  detail:   { type: Object, default: {} },    // arbitrary snapshot
  ip:       { type: String, default: '' },
}, { timestamps: true });

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ aksi: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
