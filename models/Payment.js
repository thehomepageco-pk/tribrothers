const mongoose = require('mongoose');

const PAYMENT_METHODS = ['TT', 'Cash', 'Cheque', 'LC', 'Other'];

const paymentSchema = new mongoose.Schema(
  {
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, default: 'USD', trim: true, uppercase: true },
    paymentDate: { type: Date, required: true },
    method: { type: String, enum: PAYMENT_METHODS, default: 'TT' },
    reference: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

paymentSchema.index({ invoice: 1 });

module.exports = mongoose.model('Payment', paymentSchema);
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
