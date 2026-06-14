const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  judul:        { type: String, required: true, maxlength: 150, trim: true },
  deskripsi:    { type: String, required: true },
  picUserId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  dibuatOleh:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  direktoratId: { type: mongoose.Schema.Types.ObjectId, ref: 'Direktorat', required: true },
  prioritas:    { type: String, enum: ['low', 'medium', 'high', 'critical'], required: true },
  status: {
    type: String,
    enum: ['menunggu_approval', 'to_do', 'in_progress', 'perlu_review', 'revisi', 'done', 'ditolak'],
    default: 'menunggu_approval',
  },
  deadline:        { type: Date, required: true },
  tags:            { type: [String], default: [], validate: v => v.length <= 5 },
  collaborators:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  catatanDireksi:  { type: String, default: null },
  isDeleted:       { type: Boolean, default: false },
  deletedAt:       { type: Date, default: null },
  archivedAt:      { type: Date, default: null },
  approvedAt:      { type: Date, default: null },
  doneAt:          { type: Date, default: null },
  revisiCount:     { type: Number, default: 0 },
  coverImage:      { type: String, default: null },
  dependencies:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'Task' }],
  recurrence: {
    tipe:    { type: String, enum: ['none','daily','weekly','monthly'], default: 'none' },
    interval:{ type: Number, default: 1 },
    nextRun: { type: Date, default: null },
    parentId:{ type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
  },
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaskTemplate', default: null },
}, { timestamps: true });

taskSchema.index({ direktoratId: 1, status: 1 });
taskSchema.index({ picUserId: 1, status: 1 });
taskSchema.index({ deadline: 1 });

module.exports = mongoose.model('Task', taskSchema);
