const {
  indentCommissionTotal: calcIndentCommissionTotal,
  indentQtyInMt,
  contractLinesFromDoc,
  lineQtyInMt,
} = require('./commission-calc');

/** Client commission from selling price margin (or legacy rate × MT) */
function indentCommissionTotal(indent, contract) {
  return calcIndentCommissionTotal(indent, contract);
}

function contractLineValue(line) {
  return (Number(line.quantity) || 0) * (Number(line.price) || 0);
}

function contractTotalValue(contract) {
  return contractLinesFromDoc(contract).reduce((sum, line) => sum + contractLineValue(line), 0);
}

function invoiceSubtotal(invoice) {
  return (invoice.lines || []).reduce(
    (sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0),
    0
  );
}

function amountInUsd(amount, currency, usdToPkrRate) {
  const cur = String(currency || 'USD').toUpperCase();
  const n = Number(amount) || 0;
  if (cur === 'USD') return n;
  if (cur === 'PKR' && usdToPkrRate > 0) return n / usdToPkrRate;
  return n;
}

function formatMoneyDisplay(amountUsd, displayCurrency, usdToPkrRate) {
  const cur = String(displayCurrency || 'USD').toUpperCase();
  if (cur === 'PKR') {
    const pkr = amountUsd * (usdToPkrRate > 0 ? usdToPkrRate : 1);
    return { value: pkr, symbol: 'PKR ', currency: 'PKR' };
  }
  return { value: amountUsd, symbol: '$', currency: 'USD' };
}

module.exports = {
  lineQtyInMt,
  indentQtyInMt,
  indentCommissionTotal,
  contractLinesFromDoc,
  contractLineValue,
  contractTotalValue,
  invoiceSubtotal,
  amountInUsd,
  formatMoneyDisplay,
};
