const mongoose = require('mongoose');

const subtaskSchema = new mongoose.Schema({
  taskId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
  judul:      { type: String, required: true, maxlength: 100, trim: true },
  isDone:     { type: Boolean, default: false },
  urutan:     { type: Number, default: 0 },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  dueDate:    { type: Date, default: null },
  priority:   { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
}, { timestamps: true });

subtaskSchema.index({ taskId: 1, urutan: 1 });

module.exports = mongoose.model('Subtask', subtaskSchema);
