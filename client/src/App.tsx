import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import type { Permissions } from '@/types'
import LoginPage from '@/pages/LoginPage'

const DashboardPage = lazy(() => import('@/pages/DashboardPage'))
const ProductsPage = lazy(() => import('@/pages/ProductsPage'))
const SuppliersPage = lazy(() => import('@/pages/SuppliersPage'))
const ClientsPage = lazy(() => import('@/pages/ClientsPage'))
const QuotesPage = lazy(() => import('@/pages/QuotesPage'))
const TasksPage = lazy(() => import('@/pages/TasksPage'))
const SalesContractsPage = lazy(() => import('@/pages/SalesContractsPage'))
const IndentsPage = lazy(() => import('@/pages/IndentsPage'))
const ShipmentsPage = lazy(() => import('@/pages/ShipmentsPage'))
const InvoicesPage = lazy(() => import('@/pages/InvoicesPage'))
const CommissionsPage = lazy(() => import('@/pages/CommissionsPage'))
const MailPage = lazy(() => import('@/pages/MailPage'))
const ReportsPage = lazy(() => import('@/pages/ReportsPage'))
const SessionsPage = lazy(() => import('@/pages/SessionsPage'))
const AdminPage = lazy(() => import('@/pages/AdminPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))

function guard(element: ReactNode, permission?: keyof Permissions | 'mail', adminOnly?: boolean) {
  return (
    <ProtectedRoute permission={permission} adminOnly={adminOnly}>
      <Suspense fallback={<div className="loading-block">Loading…</div>}>{element}</Suspense>
    </ProtectedRoute>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={guard(<DashboardPage />, 'dashboard')} />
        <Route path="products" element={guard(<ProductsPage />, 'products')} />
        <Route path="suppliers" element={guard(<SuppliersPage />, 'suppliers')} />
        <Route path="clients" element={guard(<ClientsPage />, 'clients')} />
        <Route path="quotes" element={guard(<QuotesPage />, 'quotes')} />
        <Route path="tasks" element={guard(<TasksPage />, 'dashboard')} />
        <Route path="sales-contracts" element={guard(<SalesContractsPage />, 'quotes')} />
        <Route path="indents" element={guard(<IndentsPage />, 'quotes')} />
        <Route path="shipments" element={guard(<ShipmentsPage />, 'quotes')} />
        <Route path="invoices" element={guard(<InvoicesPage />, 'quotes')} />
        <Route path="commissions" element={guard(<CommissionsPage />, 'quotes')} />
        <Route path="mail" element={guard(<MailPage />, 'mail')} />
        <Route path="reports" element={guard(<ReportsPage />, 'quotes')} />
        <Route path="sessions" element={guard(<SessionsPage />, 'sessions')} />
        <Route path="admin" element={guard(<AdminPage />, 'adminPanel')} />
        <Route path="settings" element={guard(<SettingsPage />, undefined, true)} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
