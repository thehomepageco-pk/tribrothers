const mongoose = require('mongoose');

const PAYMENT_TERMS = ['LC at sight', 'DP', 'CAD', 'DP at sight', 'TT', 'Custom'];
const CONTRACT_TERMS = ['CNF', 'FOB', 'Custom'];
const SHIPMENT_TYPES = ['FCL', 'LCL', 'Bulk'];
const QUANTITY_UNITS = ['KGS', 'MT'];

const productLineSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 0 },
    quantityUnit: { type: String, enum: QUANTITY_UNITS, default: 'MT' },
    price: { type: Number, required: true, min: 0 },
    /** Free-text specs note (replaces itemSpecsFile) */
    itemSpecsNote: { type: String, default: '', trim: true },
    packing: { type: String, default: '', trim: true },
    /** Legacy file field — kept for old records */
    itemSpecsFile: { type: String, default: null },
  },
  { _id: true }
);

const bankDetailsSchema = new mongoose.Schema(
  {
    bankName: { type: String, default: '', trim: true },
    swiftCode: { type: String, default: '', trim: true },
    accountNumber: { type: String, default: '', trim: true },
    bankAddress: { type: String, default: '', trim: true },
  },
  { _id: false }
);

const salesContractSchema = new mongoose.Schema(
  {
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    originCountry: { type: String, required: true, trim: true },
    productLines: {
      type: [productLineSchema],
      validate: [(v) => Array.isArray(v) && v.length > 0, 'At least one product line is required'],
    },
    // Legacy single-product fields (migrated on read)
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    quantity: { type: Number, min: 0 },
    price: { type: Number, min: 0 },
    quantityUnit: { type: String, enum: QUANTITY_UNITS },
    contractTerms: { type: String, required: true, trim: true },
    contractTermsCustom: { type: String, default: '', trim: true },
    paymentTerms: { type: String, required: true, trim: true },
    paymentTermsCustom: { type: String, default: '', trim: true },
    cadDays: { type: Number, min: 1 },
    daDays: { type: Number, min: 1 },
    shipmentType: { type: String, enum: SHIPMENT_TYPES, required: true },
    priceCurrency: { type: String, default: 'USD', trim: true, uppercase: true },
    contractDate: { type: Date, required: true },
    contractNumber: { type: String, required: true, trim: true },
    deliveryTime: { type: String, required: true, trim: true },
    specialInstructions: { type: String, default: '', trim: true },
    contractFile: { type: String, default: null },
    brandName: { type: String, default: '', trim: true },
    portOfShipment: { type: String, default: '', trim: true },
    portOfDischarge: { type: String, default: '', trim: true },
    /** Commission the supplier pays Tri Brothers (per MT) */
    supplierCommissionPerMt: { type: Number, default: 0, min: 0 },
    supplierCommissionCurrency: { type: String, default: 'USD', trim: true, uppercase: true },
    /** Snapshot of supplier bank used on this contract */
    supplierBank: { type: bankDetailsSchema, default: () => ({}) },
    supplierBankAccountId: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true }
);

salesContractSchema.index({ contractNumber: 1 }, { unique: true });

module.exports = mongoose.model('SalesContract', salesContractSchema);
module.exports.PAYMENT_TERMS = PAYMENT_TERMS;
module.exports.CONTRACT_TERMS = CONTRACT_TERMS;
module.exports.SHIPMENT_TYPES = SHIPMENT_TYPES;
module.exports.QUANTITY_UNITS = QUANTITY_UNITS;
