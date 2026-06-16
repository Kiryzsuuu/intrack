const mongoose = require('mongoose');

const taskMessageSchema = new mongoose.Schema({
  taskId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isi:     { type: String, required: true, maxlength: 2000 },
  editedAt:{ type: Date, default: null },
}, { timestamps: true });

taskMessageSchema.index({ taskId: 1, createdAt: 1 });

module.exports = mongoose.model('TaskMessage', taskMessageSchema);
