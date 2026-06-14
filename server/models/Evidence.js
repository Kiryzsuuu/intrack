const mongoose = require('mongoose');

const evidenceSchema = new mongoose.Schema({
  taskId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
  uploaderId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  namaFile:    { type: String, required: true },
  urlFile:     { type: String, required: true },
  ukuran:      { type: Number, required: true },
  mimeType:    { type: String },
}, { timestamps: true });

evidenceSchema.index({ taskId: 1 });

module.exports = mongoose.model('Evidence', evidenceSchema);
