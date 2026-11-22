const mongoose = require('mongoose');

const supplierProductSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierPrice: { type: Number },
    currency: { type: String, default: 'USD' },
    MOQ: { type: String },
    leadTime: { type: String },
    notes: { type: String },
    productInfoFile: { type: String }, // supplier-provided product information document
    packingImage: { type: String },    // product packing image per supplier
    lastUpdated: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

supplierProductSchema.index({ productId: 1, supplierId: 1 }, { unique: true });

module.exports = mongoose.model('SupplierProduct', supplierProductSchema);
