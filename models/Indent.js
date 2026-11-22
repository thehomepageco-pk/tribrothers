const mongoose = require('mongoose');

const indentLineSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    contractLineId: { type: mongoose.Schema.Types.ObjectId },
    quantity: { type: Number, required: true, min: 0.001 },
    quantityUnit: { type: String, enum: ['KGS', 'MT'], default: 'MT' },
    ntnNumber: { type: String, default: '', trim: true },
  },
  { _id: true }
);

const indentSchema = new mongoose.Schema(
  {
    salesContract: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesContract', required: true },
    indentNumber: { type: String, required: true, trim: true },
    indentDate: { type: Date, required: true },
    lines: {
      type: [indentLineSchema],
      validate: [(v) => Array.isArray(v) && v.length > 0, 'At least one client line is required'],
    },
    notes: { type: String, default: '', trim: true },
    remarks: { type: String, default: '', trim: true },
    lastDateOfShipment: { type: Date },
    portOfShipment: { type: String, default: '', trim: true },
    portOfDischarge: { type: String, default: '', trim: true },
    /** Selling price to client (per MT) — used with client commission */
    sellingPricePerMt: { type: Number, default: 0, min: 0 },
    sellingPriceCurrency: { type: String, default: 'USD', trim: true, uppercase: true },
    /** Commission from client (per MT) */
    clientCommissionPerMt: { type: Number, default: 0, min: 0 },
    clientCommissionCurrency: { type: String, default: 'USD', trim: true, uppercase: true },
    /** Legacy alias — mirrored from clientCommissionPerMt for older reports */
    commissionPerMt: { type: Number, default: 0, min: 0 },
    commissionCurrency: { type: String, default: 'USD', trim: true, uppercase: true },
  },
  { timestamps: true }
);

indentSchema.index({ indentNumber: 1 }, { unique: true });
indentSchema.index({ salesContract: 1 });

module.exports = mongoose.model('Indent', indentSchema);
