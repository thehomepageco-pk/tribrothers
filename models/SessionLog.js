const mongoose = require('mongoose');

const sessionLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    username: { type: String },
    role: { type: String, default: 'user' },
    action: { type: String, required: true }, // e.g. LOGIN, LOGOUT, CREATE_PRODUCT
    entityType: { type: String }, // Product, Supplier, Client, etc.
    entityId: { type: mongoose.Schema.Types.ObjectId },
    details: { type: Object },
    ip: { type: String },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

module.exports = mongoose.model('SessionLog', sessionLogSchema);

