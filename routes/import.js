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
      'One company = one record. Repeat the same companyName on extra rows to add more contact people',
      'View the company to see every contact person listed together',
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
      'One company = one supplier row. Repeat the same companyName on extra rows to add more contact people',
      'View the supplier to see every contact person listed together',
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
  if (!name && !email && !mobile && !tel) return [];
  return [
    {
      name: name || email || mobile || tel,
      email: email || '',
      mobile: mobile || '',
      tel: tel || '',
      department: department || '',
      whatsapp: whatsapp || '',
      wechat: wechat || '',
    },
  ];
}

function contactKey(c) {
  const email = String(c?.email || '')
    .trim()
    .toLowerCase();
  if (email) return `e:${email}`;
  const name = String(c?.name || '')
    .trim()
    .toLowerCase();
  const mobile = String(c?.mobile || c?.tel || '')
    .trim()
    .toLowerCase();
  if (name || mobile) return `n:${name}|${mobile}`;
  return '';
}

/** Append contacts that are not already on the company (by email, or name+phone). */
function mergeContacts(existingList, incoming) {
  const list = Array.isArray(existingList) ? [...existingList] : [];
  const seen = new Set(list.map(contactKey).filter(Boolean));
  const added = [];
  for (const c of incoming || []) {
    const key = contactKey(c);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    list.push(c);
    added.push(c);
  }
  return { contacts: list, added };
}

function fillIfEmpty(current, next) {
  const cur = String(current || '').trim();
  if (cur) return cur;
  return String(next || '').trim();
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

/**
 * Collapse CSV rows with the same company into one company + many contact persons.
 * First non-empty company fields win; all contact columns across rows are merged.
 */
function groupCompanyRows(rows, nameKeys) {
  const groups = new Map();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const line = i + 2;
    const companyName = pick(row, ...nameKeys);
    if (!companyName) {
      if (!groups.has('__missing__')) groups.set('__missing__', { missing: true, items: [] });
      groups.get('__missing__').items.push({ line, row });
      continue;
    }
    const key = companyName.trim().toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, {
        companyName: companyName.trim(),
        lines: [],
        rows: [],
        contacts: [],
      });
    }
    const g = groups.get(key);
    g.lines.push(line);
    g.rows.push(row);
    g.contacts.push(...contactFromRow(row));
  }
  return groups;
}

function firstPick(rows, ...keys) {
  for (const row of rows) {
    const v = pick(row, ...keys);
    if (v) return v;
  }
  return '';
}

async function importClients(rows) {
  const created = [];
  const updated = [];
  const skipped = [];
  const errors = [];
  const groups = groupCompanyRows(rows, ['companyName', 'company', 'company name', 'client']);

  for (const [key, g] of groups) {
    if (key === '__missing__' || g.missing) {
      for (const item of g.items || []) {
        skipped.push({ line: item.line, reason: 'Missing companyName' });
      }
      continue;
    }
    const line = g.lines[0];
    try {
      const { contacts: uniqueContacts } = mergeContacts([], g.contacts);
      const existing = await Client.findOne({
        companyName: new RegExp(`^${escapeRegex(g.companyName)}$`, 'i'),
      });
      if (existing) {
        const { contacts: merged, added } = mergeContacts(existing.contactPersons, uniqueContacts);
        if (!added.length) {
          skipped.push({
            line,
            reason: `Client already exists with these contacts: ${g.companyName}`,
          });
          continue;
        }
        const patch = {
          contactPersons: merged,
          country: fillIfEmpty(existing.country, firstPick(g.rows, 'country')),
          city: fillIfEmpty(existing.city, firstPick(g.rows, 'city')),
          province: fillIfEmpty(existing.province, firstPick(g.rows, 'province')),
          address: fillIfEmpty(existing.address, firstPick(g.rows, 'address')),
          postCode: fillIfEmpty(existing.postCode, firstPick(g.rows, 'postCode', 'postal code', 'zip')),
          tel: fillIfEmpty(existing.tel, firstPick(g.rows, 'tel', 'phone')),
          mobile: fillIfEmpty(existing.mobile, firstPick(g.rows, 'mobile')),
          email: fillIfEmpty(
            existing.email,
            firstPick(g.rows, 'email') || uniqueContacts[0]?.email || '',
          ),
          web: fillIfEmpty(existing.web, firstPick(g.rows, 'web', 'website')),
          ntnNumber: fillIfEmpty(existing.ntnNumber, firstPick(g.rows, 'ntnNumber', 'ntn', 'ntn #')),
          notes: fillIfEmpty(existing.notes, firstPick(g.rows, 'notes', 'note')),
        };
        await Client.findByIdAndUpdate(existing._id, { $set: patch }, { new: true });
        updated.push({
          line,
          id: existing._id,
          name: existing.companyName,
          contactsAdded: added.length,
          contact: added.map((c) => c.name || c.email).filter(Boolean).join(', '),
        });
        continue;
      }

      const email = firstPick(g.rows, 'email') || uniqueContacts[0]?.email || '';
      const doc = await Client.create({
        companyName: g.companyName,
        country: firstPick(g.rows, 'country'),
        city: firstPick(g.rows, 'city'),
        province: firstPick(g.rows, 'province'),
        address: firstPick(g.rows, 'address'),
        postCode: firstPick(g.rows, 'postCode', 'postal code', 'zip'),
        tel: firstPick(g.rows, 'tel', 'phone'),
        mobile: firstPick(g.rows, 'mobile'),
        email,
        web: firstPick(g.rows, 'web', 'website'),
        ntnNumber: firstPick(g.rows, 'ntnNumber', 'ntn', 'ntn #'),
        notes: firstPick(g.rows, 'notes', 'note'),
        contactPersons: uniqueContacts,
        showAsNew: true,
      });
      created.push({
        line,
        id: doc._id,
        name: doc.companyName,
        contactsAdded: uniqueContacts.length,
        contact: uniqueContacts.map((c) => c.name || c.email).filter(Boolean).join(', '),
      });
    } catch (err) {
      errors.push({ line, reason: err.message || 'Failed' });
    }
  }
  return { created, updated, skipped, errors };
}

async function importSuppliers(rows) {
  const created = [];
  const updated = [];
  const skipped = [];
  const errors = [];
  const groups = groupCompanyRows(rows, ['companyName', 'company', 'company name', 'supplier']);

  for (const [key, g] of groups) {
    if (key === '__missing__' || g.missing) {
      for (const item of g.items || []) {
        skipped.push({ line: item.line, reason: 'Missing companyName' });
      }
      continue;
    }
    const line = g.lines[0];
    try {
      const { contacts: uniqueContacts } = mergeContacts([], g.contacts);
      const existing = await Supplier.findOne({
        companyName: new RegExp(`^${escapeRegex(g.companyName)}$`, 'i'),
      });
      if (existing) {
        const { contacts: merged, added } = mergeContacts(existing.contactPersons, uniqueContacts);
        if (!added.length) {
          skipped.push({
            line,
            reason: `Supplier already exists with these contacts: ${g.companyName}`,
          });
          continue;
        }
        const patch = {
          contactPersons: merged,
          country: fillIfEmpty(existing.country, firstPick(g.rows, 'country')),
          city: fillIfEmpty(existing.city, firstPick(g.rows, 'city')),
          province: fillIfEmpty(existing.province, firstPick(g.rows, 'province')),
          address: fillIfEmpty(existing.address, firstPick(g.rows, 'address')),
          postCode: fillIfEmpty(existing.postCode, firstPick(g.rows, 'postCode', 'postal code', 'zip')),
          web: fillIfEmpty(existing.web, firstPick(g.rows, 'web', 'website')),
        };
        await Supplier.findByIdAndUpdate(existing._id, { $set: patch }, { new: true });
        updated.push({
          line,
          id: existing._id,
          name: existing.companyName,
          contactsAdded: added.length,
          contact: added.map((c) => c.name || c.email).filter(Boolean).join(', '),
        });
        continue;
      }

      const doc = await Supplier.create({
        companyName: g.companyName,
        country: firstPick(g.rows, 'country'),
        city: firstPick(g.rows, 'city'),
        province: firstPick(g.rows, 'province'),
        address: firstPick(g.rows, 'address'),
        postCode: firstPick(g.rows, 'postCode', 'postal code', 'zip'),
        web: firstPick(g.rows, 'web', 'website'),
        contactPersons: uniqueContacts,
        showAsNew: true,
      });
      created.push({
        line,
        id: doc._id,
        name: doc.companyName,
        contactsAdded: uniqueContacts.length,
        contact: uniqueContacts.map((c) => c.name || c.email).filter(Boolean).join(', '),
      });
    } catch (err) {
      errors.push({ line, reason: err.message || 'Failed' });
    }
  }
  return { created, updated, skipped, errors };
}

function aiRecordsToRows(type, records) {
  const rows = [];
  for (const r of records || []) {
    const companyName = r.companyName;
    if (!companyName) continue;
    const contacts = Array.isArray(r.contacts) && r.contacts.length
      ? r.contacts
      : [{ name: '', email: r.email || '', mobile: r.mobile || '', tel: r.tel || '' }];
    contacts.forEach((c, idx) => {
      const base =
        type === 'clients'
          ? {
              companyName,
              country: idx === 0 ? r.country : '',
              city: idx === 0 ? r.city : '',
              province: idx === 0 ? r.province : '',
              address: idx === 0 ? r.address : '',
              postCode: idx === 0 ? r.postCode : '',
              tel: idx === 0 ? r.tel : '',
              mobile: idx === 0 ? r.mobile : '',
              email: idx === 0 ? r.email : '',
              web: idx === 0 ? r.web : '',
              notes: idx === 0 ? r.notes : '',
            }
          : {
              companyName,
              country: idx === 0 ? r.country : '',
              city: idx === 0 ? r.city : '',
              province: idx === 0 ? r.province : '',
              address: idx === 0 ? r.address : '',
              postCode: idx === 0 ? r.postCode : '',
              web: idx === 0 ? r.web : '',
            };
      rows.push({
        ...base,
        contactName: c?.name || '',
        contactEmail: c?.email || (idx === 0 ? r.email : '') || '',
        contactMobile: c?.mobile || '',
        contactTel: c?.tel || '',
        contactDepartment: c?.department || '',
        contactWhatsapp: c?.whatsapp || '',
        contactWechat: c?.wechat || '',
      });
    });
  }
  return rows;
}

async function createFromAiRecords(type, records) {
  const rows = aiRecordsToRows(type, records);
  if (type === 'clients') return importClients(rows);
  return importSuppliers(rows);
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
    const updatedCount = result.updated?.length || 0;
    const parts = [`Imported ${result.created.length} ${type}`];
    if (updatedCount) parts.push(`added contacts on ${updatedCount} existing`);
    res.json({
      message: parts.join(' · '),
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
    const updatedCount = result.updated?.length || 0;
    const parts = [`AI imported ${result.created.length} ${type}`];
    if (updatedCount) parts.push(`added contacts on ${updatedCount} existing`);
    res.json({
      message: parts.join(' · '),
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
