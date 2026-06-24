const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  judul:        { type: String, required: true, maxlength: 150, trim: true },
  deskripsi:    { type: String, required: true },
  // Multi-assignee: orang-orang yang mengerjakan task ini
  assignees:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  dibuatOleh:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // creator utama
  // Co-creator: beberapa orang bisa jadi task creator (hanya diatur oleh creator utama)
  creators:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  // Validator (direktur) — salah satu approve → task complete
  validators:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  approvedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  direktoratId: { type: mongoose.Schema.Types.ObjectId, ref: 'Direktorat', required: true },
  prioritas:    { type: String, enum: ['normal', 'moderate', 'urgent'], default: 'normal' },
  status: {
    type: String,
    enum: ['to_do', 'on_progress', 'partially_complete', 'complete'],
    default: 'to_do',
  },
  deadline:        { type: Date, required: true },
  // Assignee yang sudah menandai bagiannya selesai (menunggu approval creator)
  completedBy:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  // True saat semua assignee selesai & menunggu approval creator
  pendingApproval: { type: Boolean, default: false },
  catatanDireksi:  { type: String, default: null },
  isDeleted:       { type: Boolean, default: false },
  deletedAt:       { type: Date, default: null },
  archivedAt:      { type: Date, default: null },
  approvedAt:      { type: Date, default: null },
  doneAt:          { type: Date, default: null },
  revisiCount:     { type: Number, default: 0 },
  coverImage:      { type: String, default: null },
  milestoneId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Milestone', default: null },
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
taskSchema.index({ assignees: 1, status: 1 });
taskSchema.index({ deadline: 1 });

module.exports = mongoose.model('Task', taskSchema);
