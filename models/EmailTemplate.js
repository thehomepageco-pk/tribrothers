const mongoose = require('mongoose');

const emailTemplateSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    subject: { type: String, required: true },
    bodyHtml: { type: String, required: true },
    recipientTypes: [{ type: String, enum: ['supplier', 'client', 'any'] }],
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);
