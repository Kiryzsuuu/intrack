const mongoose = require('mongoose');

const subtaskSchema = new mongoose.Schema({
  taskId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
  // Nesting: null = subtask langsung di bawah task; selain itu di bawah subtask lain
  parentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Subtask', default: null },
  judul:      { type: String, required: true, maxlength: 100, trim: true },
  // Subtask kini mirip task utama: punya deskripsi, deadline, assignee, validator
  deskripsi:  { type: String, default: '' },
  // Status: To Do / On Progress / Review (dikirim ke approval) / Done (di-approve)
  status:     { type: String, enum: ['to_do', 'on_progress', 'review', 'done'], default: 'to_do' },
  isDone:     { type: Boolean, default: false }, // sinkron: true bila status === 'done'
  // Menunggu approval validator setelah di-Send
  pendingApproval: { type: Boolean, default: false },
  // Penjelasan pekerjaan (free text) oleh assignee
  workNote:   { type: String, default: '' },
  urutan:     { type: Number, default: 0 },
  // Subtask & turunannya bisa di-assign ke beberapa orang
  assignees:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  // Validator (Task Approval) untuk subtask ini
  validators: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  dueDate:    { type: Date, default: null },
  priority:   { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
}, { timestamps: true });

subtaskSchema.index({ taskId: 1, urutan: 1 });
subtaskSchema.index({ parentId: 1 });

module.exports = mongoose.model('Subtask', subtaskSchema);
