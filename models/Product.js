const mongoose = require('mongoose');

// Master catalog only. Supplier links via SupplierProduct; client links via ProductClient.
const productSchema = new mongoose.Schema(
  {
    category: String, // legacy single category; kept in sync when saving
    categories: [{ type: String, trim: true }],
    name: String,
    specs: String,
    packing: String,
    specification: String,
    packingPic: String,
    otherDocuments: [{ type: String }],
    productNote: { type: String, default: '' },
    hsCode: String,
    importDuty: { type: Number },
    incomeTax: { type: Number },
    salesTax: { type: Number },
    showAsNew: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Product', productSchema);