const mongoose = require('mongoose');

const subtaskSchema = new mongoose.Schema({
  taskId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
  // Nesting: null = subtask langsung di bawah task; selain itu di bawah subtask lain
  parentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Subtask', default: null },
  judul:      { type: String, required: true, maxlength: 100, trim: true },
  isDone:     { type: Boolean, default: false },
  urutan:     { type: Number, default: 0 },
  // Subtask & turunannya bisa di-assign ke beberapa orang
  assignees:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  dueDate:    { type: Date, default: null },
  priority:   { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
}, { timestamps: true });

subtaskSchema.index({ taskId: 1, urutan: 1 });
subtaskSchema.index({ parentId: 1 });

module.exports = mongoose.model('Subtask', subtaskSchema);
