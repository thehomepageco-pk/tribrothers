/**
 * Tri Brothers — unified mail launcher. All pages open mail.html with context.
 */
(function (global) {
  'use strict';

  function buildMailUrl(params) {
    params = params || {};
    const q = new URLSearchParams();
    if (params.template) q.set('template', params.template);
    if (params.recipientType) q.set('recipientType', params.recipientType);
    if (params.recipientId) q.set('recipientId', params.recipientId);
    if (params.productId) q.set('productId', params.productId);
    if (params.productIds && params.productIds.length) {
      q.set('productIds', params.productIds.map(String).join(','));
    }
    if (params.recipientIds && params.recipientIds.length) {
      q.set('recipientIds', params.recipientIds.map(String).join(','));
    }
    if (params.toEmail) q.set('toEmail', params.toEmail);
    const s = q.toString();
    return 'mail.html' + (s ? '?' + s : '');
  }

  function open(params, options) {
    options = options || {};
    const url = buildMailUrl(params);
    if (options.newTab) window.open(url, '_blank');
    else window.location.href = url;
  }

  /** Product row — open mail with product context */
  function product(productId, opts) {
    open(Object.assign({ productId: productId }, opts || {}));
  }

  /** Email linked suppliers about a product */
  function productToSuppliers(productId, opts) {
    open(Object.assign({
      productId: productId,
      recipientType: 'supplier',
      template: 'offer-request',
    }, opts || {}));
  }

  /** Email linked clients about a product */
  function productToClients(productId, opts) {
    open(Object.assign({
      productId: productId,
      recipientType: 'client',
      template: 'product-details-pricing',
    }, opts || {}));
  }

  /** Email a specific supplier */
  function supplier(supplierId, opts) {
    open(Object.assign({
      recipientType: 'supplier',
      recipientId: supplierId,
      template: 'offer-request',
    }, opts || {}));
  }

  /** Email a specific client */
  function client(clientId, opts) {
    open(Object.assign({
      recipientType: 'client',
      recipientId: clientId,
      template: 'product-details-pricing',
    }, opts || {}));
  }

  /** Email multiple suppliers or clients by id */
  function recipients(recipientType, recipientIds, opts) {
    open(Object.assign({
      recipientType: recipientType,
      recipientIds: recipientIds,
    }, opts || {}));
  }

  global.TriMail = {
    open,
    buildMailUrl,
    product,
    productToSuppliers,
    productToClients,
    supplier,
    client,
    recipients,
  };
})(typeof window !== 'undefined' ? window : global);
