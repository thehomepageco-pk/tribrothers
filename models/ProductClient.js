const mongoose = require('mongoose');

const productClientSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    notes: { type: String },
  },
  { timestamps: true }
);

productClientSchema.index({ productId: 1, clientId: 1 }, { unique: true });

module.exports = mongoose.model('ProductClient', productClientSchema);
