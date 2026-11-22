const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    companyName: { type: String, default: 'Tri Brothers' },
    companyAddress: { type: String, default: '' },
    companyPhone: { type: String, default: '' },
    companyEmail: { type: String, default: '' },
    defaultCurrency: { type: String, default: 'USD' },
    /** 1 USD = this many PKR (for reports display) */
    usdToPkrRate: { type: Number, default: 278, min: 0 },
    defaultMargin: { type: Number, default: 15 },
    defaultImportDuty: { type: Number, default: 0 },
    defaultIncomeTax: { type: Number, default: 0 },
    defaultSalesTax: { type: Number, default: 0 },
    mailService: { type: String, default: 'gmail' },
    mailHost: { type: String, default: '' },
    mailPort: { type: Number, default: 587 },
    mailUser: { type: String, default: '' },
    mailPass: { type: String, default: '' },
    mailFrom: { type: String, default: '' },
    emailSignature: { type: String, default: 'Best regards,\nTri Brothers Team' },
  },
  { timestamps: true }
);

settingsSchema.statics.getGlobal = async function getGlobal() {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) {
    doc = await this.create({ key: 'global' });
  }
  return doc;
};

module.exports = mongoose.model('Settings', settingsSchema);
