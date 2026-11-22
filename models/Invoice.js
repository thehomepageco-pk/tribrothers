const mongoose = require('mongoose');

const INVOICE_STATUSES = ['Draft', 'Sent', 'Partially paid', 'Paid', 'Cancelled'];

const invoiceLineSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    description: { type: String, default: '', trim: true },
    quantity: { type: Number, required: true, min: 0 },
    quantityUnit: { type: String, enum: ['KGS', 'MT'], default: 'MT' },
    unitPrice: { type: Number, required: true, min: 0 },
  },
  { _id: true }
);

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, trim: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    salesContract: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesContract' },
    shipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment' },
    indent: { type: mongoose.Schema.Types.ObjectId, ref: 'Indent' },
    invoiceDate: { type: Date, required: true },
    dueDate: { type: Date },
    currency: { type: String, default: 'USD', trim: true, uppercase: true },
    status: { type: String, enum: INVOICE_STATUSES, default: 'Draft' },
    lines: {
      type: [invoiceLineSchema],
      validate: [(v) => Array.isArray(v) && v.length > 0, 'At least one line is required'],
    },
    notes: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

invoiceSchema.virtual('subtotal').get(function () {
  return (this.lines || []).reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
});

invoiceSchema.set('toJSON', { virtuals: true });
invoiceSchema.set('toObject', { virtuals: true });

invoiceSchema.index({ invoiceNumber: 1 }, { unique: true });
invoiceSchema.index({ client: 1 });

module.exports = mongoose.model('Invoice', invoiceSchema);
module.exports.INVOICE_STATUSES = INVOICE_STATUSES;
