/**
 * Readable English descriptions for session / activity log entries.
 */
(function (global) {
  'use strict';

  function who(ev) {
    return ev.username || (ev.userId && ev.userId.username) || 'A user';
  }

  function loc(d) {
    const parts = [d.city, d.country].filter(Boolean);
    return parts.length ? ` (${parts.join(', ')})` : '';
  }

  function formatSessionActivity(ev) {
    const user = who(ev);
    const d = ev.details || {};
    const action = ev.action || '';

    switch (action) {
      case 'LOGIN':
        return `${user} logged in`;
      case 'LOGOUT':
        return `${user} logged out`;
      case 'CREATE_SUPPLIER':
        return `${user} added supplier "${d.companyName || 'Unknown'}"${loc(d)}`;
      case 'UPDATE_SUPPLIER':
        return `${user} updated supplier "${d.companyName || 'Unknown'}"${loc(d)}`;
      case 'DELETE_SUPPLIER':
        return `${user} deleted supplier "${d.companyName || 'Unknown'}"`;
      case 'CREATE_PRODUCT':
        if (d.duplicatedFrom) {
          return `${user} duplicated product "${d.name || 'Unknown'}"`;
        }
        return `${user} added product "${d.name || 'Unknown'}"${d.category ? ` (${d.category})` : ''}`;
      case 'UPDATE_PRODUCT':
        return `${user} updated product "${d.name || 'Unknown'}"`;
      case 'DELETE_PRODUCT':
        return `${user} deleted product "${d.name || 'Unknown'}"`;
      case 'CREATE_CLIENT':
        return `${user} added client "${d.companyName || 'Unknown'}"${loc(d)}`;
      case 'UPDATE_CLIENT':
        return `${user} updated client "${d.companyName || 'Unknown'}"${loc(d)}`;
      case 'DELETE_CLIENT':
        return `${user} deleted client "${d.companyName || 'Unknown'}"${loc(d)}`;
      case 'CREATE_SUPPLIER_PRODUCT_LINK':
        return `${user} linked product "${d.productName || 'Unknown'}" to supplier "${d.supplierName || 'Unknown'}"`;
      case 'UPDATE_SUPPLIER_PRODUCT_LINK':
        if (d.change === 'packing image') {
          return `${user} uploaded a packing picture for "${d.productName || 'product'}" from supplier "${d.supplierName || 'supplier'}"`;
        }
        if (d.change === 'product info document') {
          return `${user} uploaded a product document for "${d.productName || 'product'}" from supplier "${d.supplierName || 'supplier'}"`;
        }
        if (d.notes !== undefined) {
          return `${user} updated notes on product link "${d.productName || 'product'}" / "${d.supplierName || 'supplier'}"`;
        }
        return `${user} updated product link "${d.productName || 'product'}" / "${d.supplierName || 'supplier'}"`;
      case 'DELETE_SUPPLIER_PRODUCT_LINK':
        return `${user} removed product "${d.productName || 'Unknown'}" from supplier "${d.supplierName || 'Unknown'}"`;
      case 'CREATE_SALES_CONTRACT':
        return `${user} created sales contract "${d.contractNumber || 'Unknown'}" with supplier "${d.supplierName || 'Unknown'}"${d.productCount ? ` (${d.productCount} product line${d.productCount === 1 ? '' : 's'})` : d.productName ? ` for product "${d.productName}"` : ''}${d.originCountry ? ` — origin ${d.originCountry}` : ''}`;
      case 'UPDATE_SALES_CONTRACT':
        return `${user} updated sales contract "${d.contractNumber || 'Unknown'}"`;
      case 'DELETE_SALES_CONTRACT':
        return `${user} deleted sales contract "${d.contractNumber || 'Unknown'}"`;
      case 'CREATE_INDENT':
        return `${user} created indent "${d.indentNumber || 'Unknown'}" for contract "${d.contractNumber || 'Unknown'}" (${d.quantity || '?'} units)`;
      case 'UPDATE_INDENT':
        return `${user} updated indent "${d.indentNumber || 'Unknown'}"`;
      case 'DELETE_INDENT':
        return `${user} deleted indent "${d.indentNumber || 'Unknown'}"`;
      case 'EMAIL_INDENT':
        return `${user} emailed indent "${d.indentNumber || 'Unknown'}" to ${d.clientName || 'client'} (${d.toEmail || ''})`;
      case 'SEND_MAIL': {
        const to = d.toEmail ? ` to ${d.toEmail}` : '';
        const tpl = d.template ? ` using template "${d.template}"` : '';
        return `${user} sent an email${to}${tpl}`;
      }
      case 'CREATE_USER':
        return `${user} created user account "${d.username || 'Unknown'}" (${d.role || 'user'})`;
      case 'UPDATE_USER':
        return `${user} updated user account "${d.username || 'Unknown'}"`;
      case 'DELETE_USER':
        return `${user} deleted user account "${d.username || 'Unknown'}"`;
      default: {
        const entity = ev.entityType ? ` ${ev.entityType.toLowerCase()}` : '';
        const readable = action.replace(/_/g, ' ').toLowerCase();
        return `${user} ${readable}${entity}`;
      }
    }
  }

  global.TriSessionActivity = { formatSessionActivity, who };
})(typeof window !== 'undefined' ? window : global);
