const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'SupplierProduct' },
    notes: { type: String },
    receivedPrice: { type: Number }, // price received from supplier after offer was sent
  },
  { timestamps: true }
);

module.exports = mongoose.model('Offer', offerSchema);
