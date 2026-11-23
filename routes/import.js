const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Product = require('../models/Product');
const Client = require('../models/Client');
const Supplier = require('../models/Supplier');
const { requirePermission } = require('../middleware/auth');
const { parseCsv, pick, escapeCsv } = require('../lib/csv-parse');
const { extractPdfText, extractEntitiesWithAi } = require('../lib/import-ai');

const router = express.Router();
const canEdit = requirePermission('canEdit');

const uploadDir = path.join(__dirname, '..', 'uploads', 'imports');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const importUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^\w.\-]+/g, '_')}`),
  }),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const okExt = name.endsWith('.csv') || name.endsWith('.pdf') || name.endsWith('.txt');
    const okMime = [
      'text/csv',
      'application/csv',
      'text/plain',
      'application/pdf',
      'application/vnd.ms-excel',
    ].includes(file.mimetype);
    if (okExt || okMime) return cb(null, true);
    return cb(new Error('Upload a .csv or .pdf file'), false);
  },
});

const TEMPLATES = {
  products: {
    filename: 'products-import-template.csv',
    headers: [
      'name',
      'category',
      'categories',
      'packing',
      'hsCode',
      'importDuty',
      'incomeTax',
      'salesTax',
      'productNote',
      'specs',
    ],
    sample: [
      'Citric Acid',
      'Chemicals',
      'Chemicals; Food',
      '25kg bags',
      '2918.14',
      '5',
      '0',
      '18',
      'Food grade',
      'Mono hydrate',
    ],
    help: [
      'Required: name',
      'category = primary category (optional if categories is set)',
      'categories = semicolon-separated list (optional)',
      'importDuty / incomeTax / salesTax = numbers (optional)',
    ],
  },
  clients: {
    filename: 'clients-import-template.csv',
    headers: [
      'companyName',
      'country',
      'city',
      'province',
      'address',
      'postCode',
      'tel',
      'mobile',
      'email',
      'web',
      'ntnNumber',
      'notes',
      'contactName',
      'contactEmail',
      'contactMobile',
      'contactTel',
      'contactDepartment',
      'contactWhatsapp',
      'contactWechat',
    ],
    sample: [
      'Apex Logistics',
      'Pakistan',
      'Karachi',
      'Sindh',
      '12 Dock Road',
      '74000',
      '021-1111111',
      '0300-1111111',
      'info@apex.example',
      'https://apex.example',
      '1234567-8',
      'Preferred buyer',
      'Ali Khan',
      'ali@apex.example',
      '0300-2222222',
      '',
      'Purchasing',
      '0300-2222222',
      '',
    ],
    help: [
      'Required: companyName',
      'One row per company (add contact columns for the primary contact)',
      'Duplicate company names are skipped',
    ],
  },
  suppliers: {
    filename: 'suppliers-import-template.csv',
    headers: [
      'companyName',
      'country',
      'city',
      'province',
      'address',
      'postCode',
      'web',
      'contactName',
      'contactEmail',
      'contactMobile',
      'contactTel',
      'contactDepartment',
      'contactWhatsapp',
      'contactWechat',
    ],
    sample: [
      'Shanghai Chem Co',
      'China',
      'Shanghai',
      '',
      '88 Bund Ave',
      '200000',
      'https://shchem.example',
      'Li Wei',
      'li@shchem.example',
      '',
      '+86-21-000000',
      'Sales',
      '',
      'liwei88',
    ],
    help: [
      'Required: companyName',
      'One row per company (add contact columns for the primary contact)',
      'Duplicate company names are skipped',
    ],
  },
};

function contactFromRow(row) {
  const name = pick(row, 'contactName', 'contact name', 'contact');
  const email = pick(row, 'contactEmail', 'contact email');
  const mobile = pick(row, 'contactMobile', 'contact mobile');
  const tel = pick(row, 'contactTel', 'contact tel');
  const department = pick(row, 'contactDepartment', 'contact department', 'department');
  const whatsapp = pick(row, 'contactWhatsapp', 'contact whatsapp', 'whatsapp');
  const wechat = pick(row, 'contactWechat', 'contact wechat', 'wechat');
  if (!name && !email) return [];
  return [{ name: name || email, email, mobile, tel, department, whatsapp, wechat }];
}

async function importProducts(rows) {
  const created = [];
  const skipped = [];
  const errors = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const line = i + 2;
    try {
      const name = pick(row, 'name', 'product', 'product name');
      if (!name) {
        skipped.push({ line, reason: 'Missing name' });
        continue;
      }
      const existing = await Product.findOne({ name: new RegExp(`^${escapeRegex(name)}$`, 'i') });
      if (existing) {
        skipped.push({ line, reason: `Product already exists: ${name}` });
        continue;
      }
      const categoriesRaw = pick(row, 'categories', 'category list');
      const category = pick(row, 'category', 'categories');
      const categories = categoriesRaw
        ? categoriesRaw.split(/[;|]/).map((s) => s.trim()).filter(Boolean)
        : category
          ? [category]
          : [];
      const doc = await Product.create({
        name,
        category: categories[0] || category || '',
        categories,
        packing: pick(row, 'packing'),
        hsCode: pick(row, 'hsCode', 'hs code', 'hscode'),
        importDuty: num(pick(row, 'importDuty', 'import duty')),
        incomeTax: num(pick(row, 'incomeTax', 'income tax')),
        salesTax: num(pick(row, 'salesTax', 'sales tax')),
        productNote: pick(row, 'productNote', 'note', 'notes'),
        specs: pick(row, 'specs', 'specification'),
        showAsNew: true,
      });
      created.push({ line, id: doc._id, name: doc.name });
    } catch (err) {
      errors.push({ line, reason: err.message || 'Failed' });
    }
  }
  return { created, skipped, errors };
}

async function importClients(rows) {
  const created = [];
  const skipped = [];
  const errors = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const line = i + 2;
    try {
      const companyName = pick(row, 'companyName', 'company', 'company name', 'client');
      if (!companyName) {
        skipped.push({ line, reason: 'Missing companyName' });
        continue;
      }
      const existing = await Client.findOne({ companyName: new RegExp(`^${escapeRegex(companyName)}$`, 'i') });
      if (existing) {
        skipped.push({ line, reason: `Client already exists: ${companyName}` });
        continue;
      }
      const contacts = contactFromRow(row);
      const email = pick(row, 'email') || contacts[0]?.email || '';
      const doc = await Client.create({
        companyName,
        country: pick(row, 'country'),
        city: pick(row, 'city'),
        province: pick(row, 'province'),
        address: pick(row, 'address'),
        postCode: pick(row, 'postCode', 'postal code', 'zip'),
        tel: pick(row, 'tel', 'phone'),
        mobile: pick(row, 'mobile'),
        email,
        web: pick(row, 'web', 'website'),
        ntnNumber: pick(row, 'ntnNumber', 'ntn', 'ntn #'),
        notes: pick(row, 'notes', 'note'),
        contactPersons: contacts,
        showAsNew: true,
      });
      created.push({ line, id: doc._id, name: doc.companyName });
    } catch (err) {
      errors.push({ line, reason: err.message || 'Failed' });
    }
  }
  return { created, skipped, errors };
}

async function importSuppliers(rows) {
  const created = [];
  const skipped = [];
  const errors = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const line = i + 2;
    try {
      const companyName = pick(row, 'companyName', 'company', 'company name', 'supplier');
      if (!companyName) {
        skipped.push({ line, reason: 'Missing companyName' });
        continue;
      }
      const existing = await Supplier.findOne({ companyName: new RegExp(`^${escapeRegex(companyName)}$`, 'i') });
      if (existing) {
        skipped.push({ line, reason: `Supplier already exists: ${companyName}` });
        continue;
      }
      const contacts = contactFromRow(row);
      const doc = await Supplier.create({
        companyName,
        country: pick(row, 'country'),
        city: pick(row, 'city'),
        province: pick(row, 'province'),
        address: pick(row, 'address'),
        postCode: pick(row, 'postCode', 'postal code', 'zip'),
        web: pick(row, 'web', 'website'),
        contactPersons: contacts,
        showAsNew: true,
      });
      created.push({ line, id: doc._id, name: doc.companyName });
    } catch (err) {
      errors.push({ line, reason: err.message || 'Failed' });
    }
  }
  return { created, skipped, errors };
}

async function createFromAiRecords(type, records) {
  if (type === 'clients') {
    return importClients(
      records.map((r) => ({
        companyName: r.companyName,
        country: r.country,
        city: r.city,
        province: r.province,
        address: r.address,
        postCode: r.postCode,
        tel: r.tel,
        mobile: r.mobile,
        email: r.email,
        web: r.web,
        notes: r.notes,
        contactName: r.contacts?.[0]?.name || '',
        contactEmail: r.contacts?.[0]?.email || r.email || '',
        contactMobile: r.contacts?.[0]?.mobile || '',
        contactTel: r.contacts?.[0]?.tel || '',
        contactDepartment: r.contacts?.[0]?.department || '',
        contactWhatsapp: r.contacts?.[0]?.whatsapp || '',
        contactWechat: r.contacts?.[0]?.wechat || '',
      })),
    );
  }
  return importSuppliers(
    records.map((r) => ({
      companyName: r.companyName,
      country: r.country,
      city: r.city,
      province: r.province,
      address: r.address,
      postCode: r.postCode,
      web: r.web,
      contactName: r.contacts?.[0]?.name || '',
      contactEmail: r.contacts?.[0]?.email || r.email || '',
      contactMobile: r.contacts?.[0]?.mobile || '',
      contactTel: r.contacts?.[0]?.tel || '',
      contactDepartment: r.contacts?.[0]?.department || '',
      contactWhatsapp: r.contacts?.[0]?.whatsapp || '',
      contactWechat: r.contacts?.[0]?.wechat || '',
    })),
  );
}

function num(v) {
  if (v === '' || v == null) return undefined;
  const n = Number(String(v).replace(/%/g, '').trim());
  return Number.isFinite(n) ? n : undefined;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanup(file) {
  if (file?.path) {
    fs.promises.unlink(file.path).catch(() => {});
  }
}

router.get('/import/template/:type', canEdit, (req, res) => {
  const type = String(req.params.type || '').toLowerCase();
  const tpl = TEMPLATES[type];
  if (!tpl) return res.status(400).json({ error: 'Unknown template type' });
  const csv = [tpl.headers.map(escapeCsv).join(','), tpl.sample.map(escapeCsv).join(',')].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${tpl.filename}"`);
  res.send(csv);
});

router.get('/import/format/:type', canEdit, (req, res) => {
  const type = String(req.params.type || '').toLowerCase();
  const tpl = TEMPLATES[type];
  if (!tpl) return res.status(400).json({ error: 'Unknown type' });
  res.json({
    type,
    headers: tpl.headers,
    sample: Object.fromEntries(tpl.headers.map((h, i) => [h, tpl.sample[i] || ''])),
    help: tpl.help,
    aiSupported: type === 'clients' || type === 'suppliers',
  });
});

router.post('/import/csv/:type', canEdit, importUpload.single('file'), async (req, res) => {
  const type = String(req.params.type || '').toLowerCase();
  if (!TEMPLATES[type]) {
    cleanup(req.file);
    return res.status(400).json({ error: 'Unknown import type' });
  }
  if (!req.file) return res.status(400).json({ error: 'Choose a CSV file' });
  try {
    const text = fs.readFileSync(req.file.path, 'utf8');
    const { rows } = parseCsv(text);
    if (!rows.length) {
      return res.status(400).json({ error: 'CSV has no data rows. Download the template and keep the header row.' });
    }
    let result;
    if (type === 'products') result = await importProducts(rows);
    else if (type === 'clients') result = await importClients(rows);
    else result = await importSuppliers(rows);
    res.json({
      message: `Imported ${result.created.length} ${type}`,
      ...result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'CSV import failed' });
  } finally {
    cleanup(req.file);
  }
});

router.post('/import/ai/:type', canEdit, importUpload.single('file'), async (req, res) => {
  const type = String(req.params.type || '').toLowerCase();
  if (type !== 'clients' && type !== 'suppliers') {
    cleanup(req.file);
    return res.status(400).json({ error: 'AI import is only available for clients and suppliers' });
  }
  if (!req.file) return res.status(400).json({ error: 'Choose a PDF file' });
  try {
    const buffer = fs.readFileSync(req.file.path);
    const text = await extractPdfText(buffer);
    if (!text || text.length < 20) {
      return res.status(400).json({ error: 'Could not read text from this PDF. Try a clearer text-based PDF.' });
    }
    const records = await extractEntitiesWithAi(type, text);
    if (!records.length) {
      return res.status(422).json({ error: 'AI did not find any companies in this PDF', records: [] });
    }
    const result = await createFromAiRecords(type, records);
    res.json({
      message: `AI imported ${result.created.length} ${type}`,
      extracted: records.length,
      preview: records.slice(0, 20),
      ...result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'AI import failed' });
  } finally {
    cleanup(req.file);
  }
});

module.exports = router;
