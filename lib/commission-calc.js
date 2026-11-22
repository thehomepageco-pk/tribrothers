/** Quantity in metric tons for commission / weight-based reporting */
function lineQtyInMt(line) {
  const q = Number(line.quantity) || 0;
  return line.quantityUnit === 'KGS' ? q / 1000 : q;
}

function contractLinesFromDoc(contract) {
  if (!contract) return [];
  if (contract.productLines && contract.productLines.length) return contract.productLines;
  if (contract.product || contract.quantity != null) {
    return [{
      product: contract.product,
      quantity: contract.quantity,
      price: contract.price,
      quantityUnit: contract.quantityUnit || 'MT',
    }];
  }
  return [];
}

function linePricePerMt(price, unit) {
  const p = Number(price) || 0;
  return unit === 'KGS' ? p * 1000 : p;
}

function indentQtyInMt(indent) {
  return (indent.lines || []).reduce((sum, line) => sum + lineQtyInMt(line), 0);
}

function findContractLineForIndentLine(contractLines, indentLine) {
  if (indentLine.contractLineId) {
    const byId = contractLines.find((l) => l._id && String(l._id) === String(indentLine.contractLineId));
    if (byId) return byId;
  }
  const pid = indentLine.product && indentLine.product._id ? indentLine.product._id : indentLine.product;
  return contractLines.find((l) => String(l.product) === String(pid)) || null;
}

/** Client margin commission from indent selling price vs contract buy price */
function computeIndentCommissionDetails(indent, contract) {
  const sell = Number(indent.sellingPricePerMt) || 0;
  const currency = String(
    indent.sellingPriceCurrency || indent.clientCommissionCurrency || indent.commissionCurrency || 'USD'
  ).trim().toUpperCase();
  const contractLines = contract ? contractLinesFromDoc(contract) : [];

  if (sell > 0 && contractLines.length && (indent.lines || []).length) {
    let quantityMt = 0;
    let totalCommission = 0;
    for (const line of indent.lines || []) {
      const qtyMt = lineQtyInMt(line);
      if (qtyMt <= 0) continue;
      const cl = findContractLineForIndentLine(contractLines, line);
      const buy = cl ? linePricePerMt(cl.price, cl.quantityUnit) : 0;
      quantityMt += qtyMt;
      totalCommission += (sell - buy) * qtyMt;
    }
    return {
      quantityMt,
      amount: Math.max(0, totalCommission),
      ratePerMt: quantityMt > 0 ? totalCommission / quantityMt : 0,
      currency,
    };
  }

  const rate = Number(indent.clientCommissionPerMt != null ? indent.clientCommissionPerMt : indent.commissionPerMt) || 0;
  const quantityMt = indentQtyInMt(indent);
  return {
    quantityMt,
    amount: Math.max(0, quantityMt * rate),
    ratePerMt: rate,
    currency: String(indent.clientCommissionCurrency || indent.commissionCurrency || 'USD').trim().toUpperCase(),
  };
}

function indentCommissionTotal(indent, contract) {
  return computeIndentCommissionDetails(indent, contract).amount;
}

function contractQtyInMt(contract) {
  return contractLinesFromDoc(contract).reduce((sum, l) => sum + lineQtyInMt(l), 0);
}

/** Supplier commission from sales contract rate × contract MT */
function computeSupplierCommissionDetails(contract) {
  const rate = Number(contract.supplierCommissionPerMt) || 0;
  const quantityMt = contractQtyInMt(contract);
  const currency = String(contract.supplierCommissionCurrency || contract.priceCurrency || 'USD').trim().toUpperCase();
  return {
    quantityMt,
    ratePerMt: rate,
    amount: Math.max(0, quantityMt * rate),
    currency,
  };
}

module.exports = {
  lineQtyInMt,
  contractLinesFromDoc,
  linePricePerMt,
  indentQtyInMt,
  computeIndentCommissionDetails,
  indentCommissionTotal,
  contractQtyInMt,
  computeSupplierCommissionDetails,
};
