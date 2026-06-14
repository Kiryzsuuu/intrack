const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subscription: { type: Object, required: true }, // { endpoint, keys: { p256dh, auth } }
  userAgent:    { type: String, default: '' },
}, { timestamps: true });

pushSubscriptionSchema.index({ userId: 1 });
pushSubscriptionSchema.index({ 'subscription.endpoint': 1 }, { unique: true });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
