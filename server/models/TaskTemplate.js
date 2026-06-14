const mongoose = require('mongoose');

const taskTemplateSchema = new mongoose.Schema({
  nama:         { type: String, required: true, maxlength: 150, trim: true },
  deskripsi:    { type: String, default: '' },
  prioritas:    { type: String, enum: ['low','medium','high','critical'], default: 'medium' },
  durasiHari:   { type: Number, default: 7, min: 1 },
  tags:         { type: [String], default: [] },
  subtasks:     [{ judul: String, urutan: Number }],
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isPublic:     { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('TaskTemplate', taskTemplateSchema);
