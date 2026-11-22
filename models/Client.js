// models/Client.js
const mongoose = require('mongoose');

const contactPersonSchema = new mongoose.Schema({
  name: String,
  department: String,
  tel: String,
  mobile: String,
  email: String,
  wechat: String,
  facebook: String,
  whatsapp: String,
  otherSocial: String,
}, { _id: false });

const clientSchema = new mongoose.Schema({
  companyName: { type: String, required: true },
  // Multiple contact people at same company (preferred).
  // Backwards compatibility: older records might still have contactPersons as strings;
  // those should be normalized by the API layer on read/write.
  contactPersons: [contactPersonSchema],
  address: String,
  postCode: String,
  city: String,
  province: String,
  country: String,
  tel: String,
  mobile: String,
  // Optional fallback / legacy "company email". Prefer contactPersons[].email.
  email: String,
  web: String,
  wechat: String,
  facebook: String,
  whatsapp: String,
  others: String,
  notes: String,
  ntnNumber: { type: String, default: '', trim: true },
  ntnFile: String, // filename of uploaded NTN file (saved as [Company]-NTN.ext)
  showAsNew: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Client', clientSchema);