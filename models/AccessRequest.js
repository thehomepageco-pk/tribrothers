const mongoose = require('mongoose');

const accessRequestSchema = new mongoose.Schema(
  {
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    permission: { type: String, required: true, trim: true },
    /** UI page key e.g. sales-contracts, products */
    pageKey: { type: String, default: '', trim: true },
    path: { type: String, default: '', trim: true },
    durationMinutes: { type: Number, default: 30 },
    note: { type: String, default: '', trim: true },
    actions: {
      view: { type: Boolean, default: true },
      canEdit: { type: Boolean, default: false },
      canDelete: { type: Boolean, default: false },
      canEmail: { type: Boolean, default: false },
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'denied', 'expired'],
      default: 'pending',
      index: true,
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

accessRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('AccessRequest', accessRequestSchema);
