const mongoose = require('mongoose');

const komentarSchema = new mongoose.Schema({
  taskId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isi:      { type: String, required: true, maxlength: 2000 },
  mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

komentarSchema.index({ taskId: 1, createdAt: 1 });

module.exports = mongoose.model('Komentar', komentarSchema);
