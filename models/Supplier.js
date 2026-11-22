const mongoose = require('mongoose');

const supplierBankAccountSchema = new mongoose.Schema(
  {
    bankName: { type: String, required: true, trim: true },
    swiftCode: { type: String, default: '', trim: true },
    accountNumber: { type: String, required: true, trim: true },
    bankAddress: { type: String, default: '', trim: true },
    label: { type: String, default: '', trim: true },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true, timestamps: true }
);

const supplierSchema = new mongoose.Schema({
  companyName: { type: String, required: true },
  contactPersons: [
    {
      name: String,
      department: String,
      tel: String,
      mobile: String,
      email: String,
      wechat: String,
      facebook: String,
      whatsapp: String,
      otherSocial: String,
    },
  ],
  address: String,
  postCode: String,
  city: String,
  province: String,
  country: String,
  web: String,
  productSpecsFile: String,
  showAsNew: { type: Boolean, default: false },
  bankAccounts: { type: [supplierBankAccountSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('Supplier', supplierSchema);
