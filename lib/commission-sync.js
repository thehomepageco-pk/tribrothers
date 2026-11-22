const Commission = require('../models/Commission');
const CommissionPayment = require('../models/CommissionPayment');
const SalesContract = require('../models/SalesContract');
const Indent = require('../models/Indent');
const {
  computeIndentCommissionDetails,
  computeSupplierCommissionDetails,
} = require('./commission-calc');

async function nextCommissionNumber() {
  const year = new Date().getFullYear();
  const prefix = `COM-${year}-`;
  const last = await Commission.findOne({
    commissionNumber: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` },
  })
    .sort({ commissionNumber: -1 })
    .select('commissionNumber')
    .lean();
  let seq = 1;
  if (last && last.commissionNumber) {
    const m = String(last.commissionNumber).match(/-(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

async function deriveCommissionStatus(commissionId, amount) {
  const payments = await CommissionPayment.find({ commission: commissionId });
  const paidAmount = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const balance = Math.max(0, (Number(amount) || 0) - paidAmount);
  let status = 'Unpaid';
  if ((Number(amount) || 0) <= 0) status = 'Unpaid';
  else if (paidAmount <= 0) status = 'Unpaid';
  else if (balance <= 0.0001) status = 'Paid';
  else status = 'Partially paid';
  return { paidAmount, balance, status, payments };
}

async function enrichCommission(doc) {
  const obj = doc && doc.toObject ? doc.toObject() : { ...doc };
  const derived = await deriveCommissionStatus(obj._id, obj.amount);
  if (obj.status !== 'Cancelled') obj.status = derived.status;
  return { ...obj, ...derived };
}

async function removeCommissionBySourceKey(sourceKey) {
  const existing = await Commission.findOne({ sourceKey });
  if (!existing) return;
  await CommissionPayment.deleteMany({ commission: existing._id });
  await Commission.deleteOne({ _id: existing._id });
}

async function upsertCommission(payload) {
  const existing = await Commission.findOne({ sourceKey: payload.sourceKey });
  if ((Number(payload.amount) || 0) <= 0 || (Number(payload.ratePerMt) || 0) <= 0) {
    if (existing) await removeCommissionBySourceKey(payload.sourceKey);
    return null;
  }

  if (existing) {
    existing.type = payload.type;
    existing.salesContract = payload.salesContract;
    existing.indent = payload.indent;
    existing.client = payload.client;
    existing.supplier = payload.supplier;
    existing.partyLabel = payload.partyLabel || '';
    existing.description = payload.description || '';
    existing.quantityMt = payload.quantityMt || 0;
    existing.ratePerMt = payload.ratePerMt || 0;
    existing.amount = payload.amount;
    existing.currency = payload.currency || 'USD';
    existing.earnedDate = payload.earnedDate || existing.earnedDate;
    if (payload.notes !== undefined) existing.notes = payload.notes;
    const derived = await deriveCommissionStatus(existing._id, existing.amount);
    if (existing.status !== 'Cancelled') existing.status = derived.status;
    await existing.save();
    return existing;
  }

  const commissionNumber = await nextCommissionNumber();
  const doc = await Commission.create({
    commissionNumber,
    status: 'Unpaid',
    ...payload,
  });
  return doc;
}

function clientPartyLabel(indent) {
  const names = (indent.lines || [])
    .map((l) => l.client && (l.client.companyName || l.client))
    .filter(Boolean);
  const unique = [...new Set(names.map(String))];
  if (!unique.length) return 'Client';
  if (unique.length <= 2) return unique.join(', ');
  return `${unique.slice(0, 2).join(', ')} +${unique.length - 2}`;
}

async function syncIndentCommission(indentId) {
  const indent = await Indent.findById(indentId)
    .populate({
      path: 'salesContract',
      populate: [{ path: 'supplier', select: 'companyName' }, { path: 'productLines.product', select: 'name' }],
    })
    .populate('lines.client', 'companyName')
    .populate('lines.product', 'name');
  if (!indent) return null;

  const contract = indent.salesContract;
  const calc = computeIndentCommissionDetails(indent, contract);
  const sourceKey = `client:indent:${indent._id}`;

  if (calc.amount <= 0 || calc.ratePerMt <= 0) {
    await removeCommissionBySourceKey(sourceKey);
    return null;
  }

  const firstClient = (indent.lines || []).find((l) => l.client);
  const clientId = firstClient && (firstClient.client._id || firstClient.client);

  return upsertCommission({
    type: 'client',
    sourceKey,
    salesContract: contract && (contract._id || contract),
    indent: indent._id,
    client: clientId || undefined,
    partyLabel: clientPartyLabel(indent),
    description: `Client margin — Indent ${indent.indentNumber}`,
    quantityMt: calc.quantityMt,
    ratePerMt: calc.ratePerMt,
    amount: calc.amount,
    currency: calc.currency,
    earnedDate: indent.indentDate || new Date(),
  });
}

async function syncSupplierCommission(contractId) {
  const contract = await SalesContract.findById(contractId)
    .populate('supplier', 'companyName')
    .populate('productLines.product', 'name');
  if (!contract) return null;

  const calc = computeSupplierCommissionDetails(contract);
  const sourceKey = `supplier:contract:${contract._id}`;

  if (calc.amount <= 0 || calc.ratePerMt <= 0) {
    await removeCommissionBySourceKey(sourceKey);
    return null;
  }

  return upsertCommission({
    type: 'supplier',
    sourceKey,
    salesContract: contract._id,
    supplier: contract.supplier && (contract.supplier._id || contract.supplier),
    partyLabel: contract.supplier?.companyName || 'Supplier',
    description: `Supplier commission — Contract ${contract.contractNumber}`,
    quantityMt: calc.quantityMt,
    ratePerMt: calc.ratePerMt,
    amount: calc.amount,
    currency: calc.currency,
    earnedDate: contract.contractDate || new Date(),
  });
}

async function syncAllCommissions() {
  const contracts = await SalesContract.find().select('_id');
  const indents = await Indent.find().select('_id');
  let synced = 0;
  for (const c of contracts) {
    const r = await syncSupplierCommission(c._id);
    if (r) synced += 1;
  }
  for (const i of indents) {
    const r = await syncIndentCommission(i._id);
    if (r) synced += 1;
  }
  return { synced, contracts: contracts.length, indents: indents.length };
}

async function removeIndentCommission(indentId) {
  await removeCommissionBySourceKey(`client:indent:${indentId}`);
}

async function removeSupplierCommission(contractId) {
  await removeCommissionBySourceKey(`supplier:contract:${contractId}`);
}

/** Server-side: derive stored commission rate on indent from selling price */
function deriveIndentCommissionFields(indent, contract) {
  const calc = computeIndentCommissionDetails(indent, contract);
  const currency = calc.currency || 'USD';
  return {
    clientCommissionPerMt: calc.ratePerMt,
    clientCommissionCurrency: currency,
    commissionPerMt: calc.ratePerMt,
    commissionCurrency: currency,
  };
}

module.exports = {
  nextCommissionNumber,
  enrichCommission,
  syncIndentCommission,
  syncSupplierCommission,
  syncAllCommissions,
  removeIndentCommission,
  removeSupplierCommission,
  deriveIndentCommissionFields,
};
