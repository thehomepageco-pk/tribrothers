import type { SessionEvent } from '@/types'

type Details = Record<string, unknown>

type LooseEvent = Omit<SessionEvent, 'details'> & {
  details?: Details | string | null
  entityType?: string
}

export function sessionUser(ev: LooseEvent): string {
  if (ev.username) return ev.username
  if (ev.userId && typeof ev.userId === 'object' && ev.userId.username) return ev.userId.username
  return 'A user'
}

export function sessionRole(ev: LooseEvent): string {
  if (ev.role) return ev.role
  if (ev.userId && typeof ev.userId === 'object' && ev.userId.role) return ev.userId.role
  return 'user'
}

function s(v: unknown, fallback = 'Unknown'): string {
  if (v == null || v === '') return fallback
  return String(v)
}

/** Readable English description for a session/activity log entry (port of session-activity.js). */
export function formatSessionActivity(ev: LooseEvent): string {
  const user = sessionUser(ev)
  const d: Details = ev.details && typeof ev.details === 'object' ? ev.details : {}
  const action = ev.action || ''
  const loc = () => {
    const parts = [d.city, d.country].filter(Boolean)
    return parts.length ? ` (${parts.join(', ')})` : ''
  }

  switch (action) {
    case 'LOGIN':
      return `${user} logged in`
    case 'LOGOUT':
      return `${user} logged out`
    case 'CREATE_SUPPLIER':
      return `${user} added supplier "${s(d.companyName)}"${loc()}`
    case 'UPDATE_SUPPLIER':
      return `${user} updated supplier "${s(d.companyName)}"${loc()}`
    case 'DELETE_SUPPLIER':
      return `${user} deleted supplier "${s(d.companyName)}"`
    case 'CREATE_PRODUCT':
      if (d.duplicatedFrom) return `${user} duplicated product "${s(d.name)}"`
      return `${user} added product "${s(d.name)}"${d.category ? ` (${s(d.category)})` : ''}`
    case 'UPDATE_PRODUCT':
      return `${user} updated product "${s(d.name)}"`
    case 'DELETE_PRODUCT':
      return `${user} deleted product "${s(d.name)}"`
    case 'CREATE_CLIENT':
      return `${user} added client "${s(d.companyName)}"${loc()}`
    case 'UPDATE_CLIENT':
      return `${user} updated client "${s(d.companyName)}"${loc()}`
    case 'DELETE_CLIENT':
      return `${user} deleted client "${s(d.companyName)}"${loc()}`
    case 'CREATE_SUPPLIER_PRODUCT_LINK':
      return `${user} linked product "${s(d.productName)}" to supplier "${s(d.supplierName)}"`
    case 'UPDATE_SUPPLIER_PRODUCT_LINK':
      if (d.change === 'packing image') {
        return `${user} uploaded a packing picture for "${s(d.productName, 'product')}" from supplier "${s(d.supplierName, 'supplier')}"`
      }
      if (d.change === 'product info document') {
        return `${user} uploaded a product document for "${s(d.productName, 'product')}" from supplier "${s(d.supplierName, 'supplier')}"`
      }
      if (d.notes !== undefined) {
        return `${user} updated notes on product link "${s(d.productName, 'product')}" / "${s(d.supplierName, 'supplier')}"`
      }
      return `${user} updated product link "${s(d.productName, 'product')}" / "${s(d.supplierName, 'supplier')}"`
    case 'DELETE_SUPPLIER_PRODUCT_LINK':
      return `${user} removed product "${s(d.productName)}" from supplier "${s(d.supplierName)}"`
    case 'CREATE_SALES_CONTRACT': {
      const count = Number(d.productCount)
      const lines = count
        ? ` (${count} product line${count === 1 ? '' : 's'})`
        : d.productName
          ? ` for product "${s(d.productName)}"`
          : ''
      return `${user} created sales contract "${s(d.contractNumber)}" with supplier "${s(d.supplierName)}"${lines}${d.originCountry ? ` — origin ${s(d.originCountry)}` : ''}`
    }
    case 'UPDATE_SALES_CONTRACT':
      return `${user} updated sales contract "${s(d.contractNumber)}"`
    case 'DELETE_SALES_CONTRACT':
      return `${user} deleted sales contract "${s(d.contractNumber)}"`
    case 'CREATE_INDENT':
      return `${user} created indent "${s(d.indentNumber)}" for contract "${s(d.contractNumber)}" (${s(d.quantity, '?')} units)`
    case 'UPDATE_INDENT':
      return `${user} updated indent "${s(d.indentNumber)}"`
    case 'DELETE_INDENT':
      return `${user} deleted indent "${s(d.indentNumber)}"`
    case 'EMAIL_INDENT':
      return `${user} emailed indent "${s(d.indentNumber)}" to ${s(d.clientName, 'client')} (${s(d.toEmail, '')})`
    case 'SEND_MAIL': {
      const to = d.toEmail ? ` to ${s(d.toEmail)}` : ''
      const tpl = d.template ? ` using template "${s(d.template)}"` : ''
      return `${user} sent an email${to}${tpl}`
    }
    case 'CREATE_USER':
      return `${user} created user account "${s(d.username)}" (${s(d.role, 'user')})`
    case 'UPDATE_USER':
      return `${user} updated user account "${s(d.username)}"`
    case 'DELETE_USER':
      return `${user} deleted user account "${s(d.username)}"`
    default: {
      const entity = ev.entityType ? ` ${ev.entityType.toLowerCase()}` : ''
      const readable = action.replace(/_/g, ' ').toLowerCase()
      return `${user} ${readable}${entity}`.trim()
    }
  }
}
