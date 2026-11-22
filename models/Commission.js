const mongoose = require('mongoose');

const COMMISSION_TYPES = ['client', 'supplier'];
const COMMISSION_STATUSES = ['Unpaid', 'Partially paid', 'Paid', 'Cancelled'];

const commissionSchema = new mongoose.Schema(
  {
    commissionNumber: { type: String, required: true, trim: true },
    type: { type: String, enum: COMMISSION_TYPES, required: true },
    /** Unique key for sync upsert, e.g. client:indent:ID or supplier:contract:ID */
    sourceKey: { type: String, required: true, trim: true, unique: true },
    salesContract: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesContract' },
    indent: { type: mongoose.Schema.Types.ObjectId, ref: 'Indent' },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
    partyLabel: { type: String, default: '', trim: true },
    description: { type: String, default: '', trim: true },
    quantityMt: { type: Number, default: 0, min: 0 },
    ratePerMt: { type: Number, default: 0, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'USD', trim: true, uppercase: true },
    status: { type: String, enum: COMMISSION_STATUSES, default: 'Unpaid' },
    dueDate: { type: Date },
    earnedDate: { type: Date },
    notes: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

commissionSchema.index({ commissionNumber: 1 }, { unique: true });
commissionSchema.index({ type: 1, status: 1 });
commissionSchema.index({ salesContract: 1 });
commissionSchema.index({ indent: 1 });

module.exports = mongoose.model('Commission', commissionSchema);
module.exports.COMMISSION_TYPES = COMMISSION_TYPES;
module.exports.COMMISSION_STATUSES = COMMISSION_STATUSES;
