const mongoose = require('mongoose');

const quotationSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    supplierProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'SupplierProduct' },
    offer: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer' }, // link to offer (supplier reference)
    baseCost: { type: Number },
    margin: { type: Number },
    duties: { type: String },
    hsCode: { type: String },
    finalPrice: { type: Number, required: true },
    notes: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Quotation', quotationSchema);
