const DEFAULT_TEMPLATES = [
  {
    slug: 'product-details',
    name: 'Product details',
    description: 'Send product specifications to a supplier or client (no pricing).',
    subject: 'Product details — {{productName}}',
    bodyHtml: `<h2>Product details</h2>
<p>Dear {{recipientName}},</p>
<p>Please find details for the following product:</p>
<p><strong>Product:</strong> {{productName}}</p>
<p><strong>Categories:</strong> {{categories}}</p>
<p><strong>Specs:</strong> {{specs}}</p>
<p><strong>Packing:</strong> {{packing}}</p>
<p><strong>HS Code:</strong> {{hsCode}}</p>
{{customMessageBlock}}
<hr/>
<p>{{signature}}</p>`,
    recipientTypes: ['supplier', 'client', 'any'],
    sortOrder: 1,
  },
  {
    slug: 'product-details-pricing',
    name: 'Product details with pricing',
    description: 'Product details including price and tax breakdown.',
    subject: 'Product & pricing — {{productName}}',
    bodyHtml: `<h2>Product &amp; pricing</h2>
<p>Dear {{recipientName}},</p>
<p><strong>Product:</strong> {{productName}}</p>
<p><strong>Categories:</strong> {{categories}}</p>
<p><strong>HS Code:</strong> {{hsCode}}</p>
<p><strong>Price:</strong> {{price}} {{currency}}</p>
<p><strong>Import duty:</strong> {{importDuty}}%</p>
<p><strong>Income tax:</strong> {{incomeTax}}%</p>
<p><strong>Sales tax:</strong> {{salesTax}}%</p>
{{customMessageBlock}}
<hr/>
<p>{{signature}}</p>`,
    recipientTypes: ['supplier', 'client', 'any'],
    sortOrder: 2,
  },
  {
    slug: 'offer-request',
    name: 'Offer request (supplier)',
    description: 'Request a quotation/offer from a supplier for a product.',
    subject: 'Offer request — {{productName}}',
    bodyHtml: `<h2>Offer request</h2>
<p>Dear {{recipientName}},</p>
<p>We would like to request an offer for the following product:</p>
<p><strong>Product:</strong> {{productName}}</p>
<p><strong>HS Code:</strong> {{hsCode}}</p>
<p><strong>Packing:</strong> {{packing}}</p>
{{customMessageBlock}}
<hr/>
<p>{{signature}}</p>`,
    recipientTypes: ['supplier', 'any'],
    sortOrder: 3,
  },
  {
    slug: 'client-quotation',
    name: 'Quotation (client)',
    description: 'Send a quotation with final price and duties to a client.',
    subject: 'Quotation — {{productName}}',
    bodyHtml: `<h2>Quotation</h2>
<p>Dear {{recipientName}},</p>
<p>Please find our quotation below:</p>
<p><strong>Product:</strong> {{productName}}</p>
<p><strong>HS Code:</strong> {{hsCode}}</p>
<p><strong>Final price:</strong> {{price}} {{currency}}</p>
<p><strong>Import duty:</strong> {{importDuty}}%</p>
<p><strong>Income tax:</strong> {{incomeTax}}%</p>
<p><strong>Sales tax:</strong> {{salesTax}}%</p>
{{customMessageBlock}}
<hr/>
<p>{{signature}}</p>`,
    recipientTypes: ['client', 'any'],
    sortOrder: 4,
  },
  {
    slug: 'general-message',
    name: 'General message',
    description: 'Short free-form note with optional product reference.',
    subject: '{{subjectLine}}',
    bodyHtml: `<p>Dear {{recipientName}},</p>
{{customMessageBlock}}
{{productBlock}}
<hr/>
<p>{{signature}}</p>`,
    recipientTypes: ['supplier', 'client', 'any'],
    sortOrder: 5,
  },
  {
    slug: 'custom-email',
    name: 'Custom email',
    description: 'Write your own subject and full email body — freeform compose.',
    subject: '{{subjectLine}}',
    bodyHtml: `<p>Dear {{recipientName}},</p>
{{customMessageBlock}}
{{productBlock}}
<hr/>
<p>{{signature}}</p>`,
    recipientTypes: ['supplier', 'client', 'any'],
    sortOrder: 0,
  },
  {
    slug: 'follow-up',
    name: 'Follow up',
    description: 'Polite follow-up on a previous communication.',
    subject: 'Follow up — {{productName}}',
    bodyHtml: `<p>Dear {{recipientName}},</p>
<p>We are following up regarding {{productName}}.</p>
{{customMessageBlock}}
<hr/>
<p>{{signature}}</p>`,
    recipientTypes: ['supplier', 'client', 'any'],
    sortOrder: 6,
  },
];

const FIELD_DEFS = {
  price: { label: 'Price', type: 'text', placeholder: 'e.g. 1500' },
  currency: { label: 'Currency', type: 'text', placeholder: 'USD' },
  importDuty: { label: 'Import duty (%)', type: 'number', placeholder: '0' },
  incomeTax: { label: 'Income tax (%)', type: 'number', placeholder: '0' },
  salesTax: { label: 'Sales tax (%)', type: 'number', placeholder: '0' },
  customMessage: { label: 'Email body', type: 'textarea', placeholder: 'Write your message…' },
  subjectLine: { label: 'Subject', type: 'text', placeholder: 'Email subject' },
};

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function detectRequiredFields(template) {
  const text = `${template.subject || ''} ${template.bodyHtml || ''}`;
  const fields = [];
  Object.keys(FIELD_DEFS).forEach((key) => {
    const re = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'i');
    if (re.test(text)) fields.push(key);
  });
  // {{customMessageBlock}} is filled from fields.customMessage
  if (/\{\{\s*customMessageBlock\s*\}\}/i.test(text) && !fields.includes('customMessage')) {
    fields.push('customMessage');
  }
  if (/\{\{\s*subjectLine\s*\}\}/i.test(text) && !fields.includes('subjectLine')) {
    fields.push('subjectLine');
  }
  return fields;
}

function productCategoryLabel(product) {
  if (!product) return 'N/A';
  if (product.categories && product.categories.length) return product.categories.join(', ');
  return product.category || 'N/A';
}

function resolveProductsList(product, products) {
  if (Array.isArray(products) && products.length) return products.filter(Boolean);
  if (product) return [product];
  return [];
}

function productPricingFields(product, settings, fields) {
  return {
    price: fields?.price ?? (product?.finalPrice != null ? product.finalPrice : ''),
    currency: fields?.currency || settings?.defaultCurrency || 'USD',
    importDuty: fields?.importDuty ?? product?.importDuty ?? settings?.defaultImportDuty ?? '0',
    incomeTax: fields?.incomeTax ?? product?.incomeTax ?? settings?.defaultIncomeTax ?? '0',
    salesTax: fields?.salesTax ?? product?.salesTax ?? settings?.defaultSalesTax ?? '0',
  };
}

function buildSingleProductBlock(product, settings, fields, includePricing) {
  if (!product) return '';
  const pricing = productPricingFields(product, settings, fields);
  let html = `<p><strong>Product:</strong> ${escapeHtml(product.name)}</p>`;
  html += `<p><strong>Categories:</strong> ${escapeHtml(productCategoryLabel(product))}</p>`;
  html += `<p><strong>Specs:</strong> ${escapeHtml(product.specs || 'N/A')}</p>`;
  html += `<p><strong>Packing:</strong> ${escapeHtml(product.packing || 'N/A')}</p>`;
  html += `<p><strong>HS Code:</strong> ${escapeHtml(product.hsCode || 'N/A')}</p>`;
  if (includePricing) {
    html += `<p><strong>Price:</strong> ${escapeHtml(pricing.price)} ${escapeHtml(pricing.currency)}</p>`;
    html += `<p><strong>Import duty:</strong> ${escapeHtml(pricing.importDuty)}%</p>`;
    html += `<p><strong>Income tax:</strong> ${escapeHtml(pricing.incomeTax)}%</p>`;
    html += `<p><strong>Sales tax:</strong> ${escapeHtml(pricing.salesTax)}%</p>`;
  }
  return html;
}

function buildMultiProductsBlock(products, settings, fields, includePricing) {
  if (!products || !products.length) return '';
  if (products.length === 1) return buildSingleProductBlock(products[0], settings, fields, includePricing);
  return products.map((product, idx) => {
    const section = buildSingleProductBlock(product, settings, fields, includePricing);
    return `<div style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #e0e0e0;">` +
      `<p style="margin:0 0 8px;font-weight:600;">${idx + 1}. ${escapeHtml(product.name || 'Product')}</p>` +
      section.replace(/^<p><strong>Product:<\/strong>[^<]*<\/p>/, '') +
      `</div>`;
  }).join('');
}

function templateUsesPricing(template) {
  const text = `${template?.subject || ''} ${template?.bodyHtml || ''}`;
  return /\{\{\s*price\s*\}\}/i.test(text) || /\{\{\s*importDuty\s*\}\}/i.test(text);
}

function buildContext({ template, settings, recipient, product, products, fields, recipientType }) {
  const sig = (settings && settings.emailSignature)
    ? String(settings.emailSignature).replace(/\n/g, '<br/>')
    : 'Best regards,<br>Tri Brothers Team';
  const companyName = recipient?.companyName || '';
  const contact = (recipient?.contactPersons && recipient.contactPersons[0]) || {};
  const recipientName = contact.name || companyName || 'Sir/Madam';
  const allProducts = resolveProductsList(product, products);
  const primary = allProducts[0] || null;
  const includePricing = templateUsesPricing(template);
  const pricing = productPricingFields(primary, settings, fields);
  const productNames = allProducts.map((p) => p.name).filter(Boolean);
  const productNameLabel = productNames.length > 1
    ? `${productNames[0]} (+${productNames.length - 1} more)`
    : (productNames[0] || '—');

  const ctx = {
    recipientName: escapeHtml(recipientName),
    companyName: escapeHtml(companyName),
    productName: escapeHtml(productNameLabel),
    categories: escapeHtml(productCategoryLabel(primary)),
    specs: escapeHtml(primary?.specs || 'N/A'),
    packing: escapeHtml(primary?.packing || 'N/A'),
    hsCode: escapeHtml(primary?.hsCode || 'N/A'),
    price: escapeHtml(pricing.price),
    currency: escapeHtml(pricing.currency),
    importDuty: escapeHtml(pricing.importDuty),
    incomeTax: escapeHtml(pricing.incomeTax),
    salesTax: escapeHtml(pricing.salesTax),
    signature: sig,
    subjectLine: escapeHtml(fields?.subjectLine || template?.name || 'Message from Tri Brothers'),
    customMessageBlock: fields?.customMessage
      ? `<p>${escapeHtml(fields.customMessage).replace(/\n/g, '<br/>')}</p>`
      : '',
    productBlock: buildMultiProductsBlock(allProducts, settings, fields, includePricing),
    productsBlock: buildMultiProductsBlock(allProducts, settings, fields, includePricing),
  };
  return ctx;
}

function renderTemplateString(str, ctx) {
  return String(str || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => (ctx[key] != null ? ctx[key] : ''));
}

function renderEmail(template, options) {
  const ctx = buildContext({ template, ...options });
  let html = renderTemplateString(template.bodyHtml, ctx);
  const allProducts = resolveProductsList(options.product, options.products);
  if (allProducts.length > 1 && !/\{\{\s*productsBlock\s*\}\}/i.test(template.bodyHtml)) {
    const block = ctx.productsBlock;
    if (block) {
      html = html.replace(/<hr\s*\/?>/i, `${block}<hr/>`);
    }
  }
  return {
    subject: renderTemplateString(template.subject, ctx),
    html,
  };
}

module.exports = {
  DEFAULT_TEMPLATES,
  FIELD_DEFS,
  detectRequiredFields,
  renderEmail,
  productCategoryLabel,
};
