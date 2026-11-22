const mongoose = require('mongoose');
const { PAYMENT_METHODS } = require('./Payment');

const commissionPaymentSchema = new mongoose.Schema(
  {
    commission: { type: mongoose.Schema.Types.ObjectId, ref: 'Commission', required: true },
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, default: 'USD', trim: true, uppercase: true },
    paymentDate: { type: Date, required: true },
    method: { type: String, enum: PAYMENT_METHODS, default: 'TT' },
    reference: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

commissionPaymentSchema.index({ commission: 1 });

module.exports = mongoose.model('CommissionPayment', commissionPaymentSchema);
