const mongoose = require('mongoose');

const SHIPMENT_STATUSES = ['Draft', 'Booked', 'In transit', 'Arrived', 'Delivered'];

const shipmentLineSchema = new mongoose.Schema(
  {
    indent: { type: mongoose.Schema.Types.ObjectId, ref: 'Indent' },
    indentLineId: { type: mongoose.Schema.Types.ObjectId },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    quantity: { type: Number, min: 0 },
    quantityUnit: { type: String, enum: ['KGS', 'MT'], default: 'MT' },
  },
  { _id: true }
);

const shipmentSchema = new mongoose.Schema(
  {
    salesContract: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesContract', required: true },
    indent: { type: mongoose.Schema.Types.ObjectId, ref: 'Indent' },
    shipmentNumber: { type: String, required: true, trim: true },
    status: { type: String, enum: SHIPMENT_STATUSES, default: 'Draft' },
    vesselName: { type: String, default: '', trim: true },
    blNumber: { type: String, default: '', trim: true },
    /** Primary shipment date (replaces ETD in UI) */
    shipmentDate: { type: Date },
    /** Legacy — kept in sync with shipmentDate when present */
    etd: { type: Date },
    eta: { type: Date },
    shipmentType: { type: String, enum: ['FCL', 'LCL', 'Bulk', ''], default: '' },
    portOfLoading: { type: String, default: '', trim: true },
    portOfDischarge: { type: String, default: '', trim: true },
    shippedQuantity: { type: Number, min: 0 },
    shippedQuantityUnit: { type: String, enum: ['KGS', 'MT', ''], default: 'MT' },
    freeDays: { type: Number, min: 0 },
    notes: { type: String, default: '', trim: true },
    lines: { type: [shipmentLineSchema], default: [] },
    blFile: { type: String, default: null },
    shippingDocsFile: { type: String, default: null },
    /** Legacy aliases */
    packingListFile: { type: String, default: null },
    arrivalNoticeFile: { type: String, default: null },
    containerNumbers: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

shipmentSchema.index({ shipmentNumber: 1 }, { unique: true });
shipmentSchema.index({ salesContract: 1 });
shipmentSchema.index({ indent: 1 });

module.exports = mongoose.model('Shipment', shipmentSchema);
module.exports.SHIPMENT_STATUSES = SHIPMENT_STATUSES;
