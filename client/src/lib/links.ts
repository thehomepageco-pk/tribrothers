const PAGE_MAP: Record<string, string> = {
  'index.html': '/',
  'products.html': '/products',
  'supplier.html': '/suppliers',
  'clients.html': '/clients',
  'quotes.html': '/quotes',
  'sales-contract.html': '/sales-contracts',
  'indent.html': '/indents',
  'shipment.html': '/shipments',
  'invoices.html': '/invoices',
  'commissions.html': '/commissions',
  'mail.html': '/mail',
  'reports.html': '/reports',
  'sessions.html': '/sessions',
  'admin.html': '/admin',
  'settings.html': '/settings',
}

/** Convert legacy `.html?x=y` links returned by the API into SPA routes. */
export function normalizeHref(href?: string | null): string {
  if (!href) return '/'
  const [path, qs] = href.split('?')
  const base = path.split('/').pop() || path
  const mapped = PAGE_MAP[base] || (href.startsWith('/') ? path.replace(/\.html$/, '') : `/${path.replace(/\.html$/, '')}`)
  return qs ? `${mapped}?${qs}` : mapped
}
