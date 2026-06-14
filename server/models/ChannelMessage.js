const mongoose = require('mongoose');

const channelMessageSchema = new mongoose.Schema({
  channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isi:       { type: String, required: true, maxlength: 4000 },
  mentions:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  editedAt:  { type: Date, default: null },
}, { timestamps: true });

channelMessageSchema.index({ channelId: 1, createdAt: 1 });

module.exports = mongoose.model('ChannelMessage', channelMessageSchema);
