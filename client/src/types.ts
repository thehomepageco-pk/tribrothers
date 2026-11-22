export type Permissions = {
  dashboard?: boolean
  products?: boolean
  suppliers?: boolean
  clients?: boolean
  quotes?: boolean
  sessions?: boolean
  adminPanel?: boolean
  canEdit?: boolean
  canDelete?: boolean
  canEmail?: boolean
}

export type AuthUser = {
  authenticated: boolean
  userId?: string
  username?: string
  displayName?: string
  email?: string
  avatarUrl?: string
  designation?: string
  mobile?: string
  whatsapp?: string
  wechat?: string
  role?: string
  permissions?: Permissions
  adminOverride?: {
    active: boolean
    expiresAt?: string | number | null
    remainingMs?: number
    unlockedBy?: string | null
    pageKey?: string
    permission?: string
    pages?: string[]
    canEdit?: boolean
    canDelete?: boolean
    canEmail?: boolean
  }
  tempAccess?: {
    active: boolean
    expiresAt?: number
    remainingMs?: number
    canEdit?: boolean
    canEmail?: boolean
    canDelete?: boolean
    permission?: string
    pageKey?: string
    pages?: string[]
  }
}

export type ContactPerson = {
  name?: string
  email?: string
  mobile?: string
  tel?: string
  department?: string
  wechat?: string
  facebook?: string
  whatsapp?: string
  otherSocial?: string
}

export type Product = {
  _id: string
  name?: string
  category?: string
  categories?: string[]
  hsCode?: string
  packing?: string
  productNote?: string
  specs?: string
  specification?: string
  packingPic?: string
  otherDocuments?: string[]
  importDuty?: number
  incomeTax?: number
  salesTax?: number
  showAsNew?: boolean
  createdAt?: string
  updatedAt?: string
}

export type Supplier = {
  _id: string
  companyName?: string
  country?: string
  contactPersons?: ContactPerson[]
  address?: string
  postCode?: string
  city?: string
  province?: string
  web?: string
  tel?: string
  mobile?: string
  wechat?: string
  facebook?: string
  whatsapp?: string
  productSpecsFile?: string
  showAsNew?: boolean
  bankAccounts?: Array<{
    _id?: string
    bankName?: string
    swiftCode?: string
    accountNumber?: string
    bankAddress?: string
  }>
  createdAt?: string
}

export type Client = {
  _id: string
  companyName?: string
  country?: string
  contactPersons?: ContactPerson[]
  address?: string
  postCode?: string
  city?: string
  province?: string
  tel?: string
  mobile?: string
  web?: string
  wechat?: string
  facebook?: string
  whatsapp?: string
  others?: string
  notes?: string
  ntnNumber?: string
  ntnFile?: string
  email?: string
  showAsNew?: boolean
  createdAt?: string
}

export type Quotation = {
  _id: string
  product?: Product | string
  client?: Client | string
  supplierProduct?: string
  offer?: string
  baseCost?: number
  margin?: number
  finalPrice?: number
  hsCode?: string
  duties?: number
  createdAt?: string
}

export type Offer = {
  _id: string
  product?: Product | string
  supplier?: Supplier | string
  notes?: string
  receivedPrice?: number
  createdAt?: string
}

export type SalesContract = {
  _id: string
  supplier?: Supplier | string
  originCountry?: string
  contractNumber?: string
  contractDate?: string
  shipmentType?: string
  priceCurrency?: string
  contractTerms?: string
  contractTermsCustom?: string
  paymentTerms?: string
  paymentTermsCustom?: string
  cadDays?: number
  deliveryTime?: string
  brandName?: string
  portOfShipment?: string
  portOfDischarge?: string
  supplierCommissionPerMt?: number
  supplierCommissionCurrency?: string
  specialInstructions?: string
  bankName?: string
  swiftCode?: string
  accountNumber?: string
  bankAddress?: string
  contractFile?: string
  productLines?: Array<{
    _id?: string
    productId?: string | Product
    quantity?: number
    quantityUnit?: string
    price?: number
    itemSpecsNote?: string
    packing?: string
    itemSpecsFile?: string
  }>
  createdAt?: string
}

export type Indent = {
  _id: string
  salesContract?: SalesContract | string
  indentNumber?: string
  indentDate?: string
  notes?: string
  remarks?: string
  lastDateOfShipment?: string
  portOfShipment?: string
  portOfDischarge?: string
  sellingPricePerMt?: number
  sellingPriceCurrency?: string
  lines?: Array<{
    clientId?: string | Client
    productId?: string | Product
    contractLineId?: string
    quantityUnit?: string
    quantity?: number
    ntnNumber?: string
  }>
  createdAt?: string
}

export type Shipment = {
  _id: string
  indent?: Indent | string
  salesContract?: SalesContract | string
  shipmentNumber?: string
  status?: string
  shipmentType?: string
  vesselName?: string
  blNumber?: string
  shipmentDate?: string
  etd?: string
  eta?: string
  portOfLoading?: string
  portOfDischarge?: string
  shippedQuantity?: number
  shippedQuantityUnit?: string
  freeDays?: number
  notes?: string
  blFile?: string
  shippingDocsFile?: string
  lines?: unknown[]
  createdAt?: string
}

export type Invoice = {
  _id: string
  client?: Client | string
  invoiceNumber?: string
  invoiceDate?: string
  dueDate?: string
  currency?: string
  status?: string
  salesContract?: SalesContract | string
  shipment?: Shipment | string
  notes?: string
  lines?: Array<{
    product?: string | Product
    description?: string
    quantity?: number
    quantityUnit?: string
    unitPrice?: number
  }>
  payments?: Array<{
    _id: string
    amount?: number
    paymentDate?: string
    method?: string
    reference?: string
  }>
  createdAt?: string
}

export type Commission = {
  _id: string
  commissionNumber?: string
  type?: string
  status?: string
  amount?: number
  currency?: string
  dueDate?: string
  notes?: string
  salesContract?: SalesContract | string
  indent?: Indent | string
  payments?: Array<{
    _id: string
    amount?: number
    paymentDate?: string
    method?: string
    reference?: string
    notes?: string
    currency?: string
  }>
  createdAt?: string
}

export type AppUser = {
  _id: string
  username: string
  displayName?: string
  email?: string
  role?: string
  isActive?: boolean
  permissions?: Permissions
  createdAt?: string
}

export type Settings = {
  companyName?: string
  companyAddress?: string
  companyPhone?: string
  companyEmail?: string
  defaultCurrency?: string
  usdToPkrRate?: number
  defaultMargin?: number
  defaultImportDuty?: number
  defaultIncomeTax?: number
  defaultSalesTax?: number
  mailService?: string
  mailHost?: string
  mailPort?: number
  mailUser?: string
  mailPass?: string
  mailFrom?: string
  emailSignature?: string
}

export type EmailTemplate = {
  _id: string
  slug?: string
  name?: string
  description?: string
  subject?: string
  bodyHtml?: string
  recipientTypes?: string[]
  requiredFields?: string[]
  isActive?: boolean
}

export type SessionEvent = {
  _id: string
  action?: string
  details?: string
  ip?: string
  createdAt?: string
  userId?: { username?: string; role?: string } | string
  username?: string
  role?: string
}

export type DashboardStats = {
  products?: number
  clients?: number
  suppliers?: number
  contracts?: number
  indents?: number
  shipments?: number
  invoices?: number
  quotations?: number
  revenue?: number
  revenueCurrency?: string
  shipmentPipeline?: Array<{ status: string; count: number }>
  recentShipments?: Shipment[]
  needsAttention?: Array<{ title: string; detail?: string; href?: string }>
  recentQuotations?: Quotation[]
  recentActivity?: SessionEvent[]
}
