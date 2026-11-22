/** Shared page / action options for timed staff unlock & access requests. */

export type AccessPageOption = {
  key: string
  label: string
  /** Permission key checked by ProtectedRoute / nav */
  permission: string
  path: string
}

export type AccessActionKey = 'view' | 'canEdit' | 'canDelete' | 'canEmail'

export const ACCESS_PAGES: AccessPageOption[] = [
  { key: 'dashboard', label: 'Dashboard', permission: 'dashboard', path: '/' },
  { key: 'products', label: 'Products', permission: 'products', path: '/products' },
  { key: 'suppliers', label: 'Suppliers', permission: 'suppliers', path: '/suppliers' },
  { key: 'clients', label: 'Clients', permission: 'clients', path: '/clients' },
  { key: 'quotes', label: 'Quotes & Offers', permission: 'quotes', path: '/quotes' },
  { key: 'sales-contracts', label: 'Sales Contracts', permission: 'quotes', path: '/sales-contracts' },
  { key: 'indents', label: 'Indents', permission: 'quotes', path: '/indents' },
  { key: 'shipments', label: 'Shipments', permission: 'quotes', path: '/shipments' },
  { key: 'invoices', label: 'Invoices', permission: 'quotes', path: '/invoices' },
  { key: 'commissions', label: 'Commissions', permission: 'quotes', path: '/commissions' },
  { key: 'reports', label: 'Reports', permission: 'quotes', path: '/reports' },
  { key: 'mail', label: 'Mail', permission: 'mail', path: '/mail' },
  { key: 'tasks', label: 'Tasks', permission: 'dashboard', path: '/tasks' },
  { key: 'sessions', label: 'Sessions', permission: 'sessions', path: '/sessions' },
  { key: 'admin', label: 'Admin panel', permission: 'adminPanel', path: '/admin' },
  { key: 'settings', label: 'Settings', permission: 'adminPanel', path: '/settings' },
]

export const ACCESS_ACTIONS: { key: AccessActionKey; label: string; hint: string }[] = [
  { key: 'view', label: 'Open / view page', hint: 'See the page in the menu and open it' },
  { key: 'canEdit', label: 'Create & edit', hint: 'Add or change records' },
  { key: 'canDelete', label: 'Delete', hint: 'Remove records' },
  { key: 'canEmail', label: 'Send email', hint: 'Use mail / email actions' },
]

export function pageKeyFromPath(pathname: string): string | null {
  const p = pathname || '/'
  if (p === '/' || p.startsWith('/dashboard')) return 'dashboard'
  const hit = ACCESS_PAGES.find((x) => x.path !== '/' && (p === x.path || p.startsWith(`${x.path}/`)))
  return hit?.key || null
}

export function permissionForPageKey(pageKey: string): string {
  return ACCESS_PAGES.find((x) => x.key === pageKey)?.permission || pageKey
}

export function pathForPageKey(pageKey: string): string {
  return ACCESS_PAGES.find((x) => x.key === pageKey)?.path || '/'
}

export function labelForPageKey(pageKey: string): string {
  return ACCESS_PAGES.find((x) => x.key === pageKey)?.label || pageKey
}
