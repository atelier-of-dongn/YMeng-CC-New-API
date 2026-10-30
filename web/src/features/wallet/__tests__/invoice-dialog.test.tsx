/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import type { InvoiceEligibility } from '../../invoices/types'
import { UserInvoiceDialog } from '../components/dialogs/user-invoice-dialog'
import { RechargeFormCard } from '../components/recharge-form-card'
import { Wallet } from '../index'

const clients: QueryClient[] = []

const eligibility: InvoiceEligibility = {
  profile: null,
  minimum_amount: 500,
  orders: [
    {
      id: 1,
      trade_no: 'AVAILABLE-ORDER',
      payment_provider: 'card',
      amount: 1000,
      created_at: 1,
      completed_at: 2,
    },
    {
      id: 2,
      trade_no: 'ISSUED-ORDER',
      payment_provider: 'card',
      amount: 1200,
      created_at: 1,
      completed_at: 2,
      invoice_status: 'issued',
    },
    {
      id: 3,
      trade_no: 'PROCESSING-ORDER',
      payment_provider: 'card',
      amount: 1500,
      created_at: 1,
      completed_at: 2,
      invoice_status: 'processing',
    },
  ],
  pending_refunds: [],
}

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <UserInvoiceDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>
  )
}

function mockWalletRequests(invoiceEnabled: boolean) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    let data: unknown
    switch (url) {
      case '/api/status':
        data = {
          SidebarModulesAdmin: JSON.stringify({
            personal: { enabled: true, topup: true, invoice: invoiceEnabled },
          }),
        }
        break
      case '/api/user/self':
        data = { id: 1, username: 'buyer', role: 1, quota: 0 }
        break
      case '/api/user/topup/info':
        data = {
          min_topup: 1,
          pay_methods: [],
          amount_options: [],
          enable_redemption: false,
        }
        break
      case '/api/user/affiliate/summary':
        data = { enabled: false }
        break
      case '/api/user/aff':
        data = ''
        break
      case '/api/subscription/plans':
        data = []
        break
      case '/api/subscription/self':
        data = { subscriptions: [], all_subscriptions: [] }
        break
      case '/api/invoice/eligibility':
        data = eligibility
        break
      case '/api/invoice/self':
        data = { items: [], total: 0 }
        break
      default:
        throw new Error(`Unexpected GET ${url}`)
    }
    return { data: { success: true, data } }
  })
}

async function renderWallet() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  useAuthStore.getState().auth.setUser({ id: 1, username: 'buyer', role: 1 })
  const root = createRootRoute()
  const walletRoute = createRoute({
    getParentRoute: () => root,
    path: '/wallet',
    component: Wallet,
  })
  const router = createRouter({
    routeTree: root.addChildren([walletRoute]),
    history: createMemoryHistory({ initialEntries: ['/wallet'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  for (const client of clients) client.clear()
  clients.length = 0
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
})

test('keeps form input and order selection when switching invoice lists', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/invoice/eligibility') {
      return { data: { success: true, data: eligibility } }
    }
    return { data: { success: true, data: { items: [], total: 0 } } }
  })
  renderDialog()
  const user = userEvent.setup()
  const orderCheckbox = await screen.findByRole('checkbox', {
    name: 'Select order AVAILABLE-ORDER',
  })
  expect(screen.queryByText('ISSUED-ORDER')).not.toBeInTheDocument()
  expect(
    screen.getByRole('checkbox', { name: 'Select order PROCESSING-ORDER' })
  ).toHaveAttribute('aria-disabled', 'true')
  await user.click(orderCheckbox)
  await user.type(screen.getByLabelText('Invoice title'), 'Example Company')
  expect(screen.getByText('Selected 1')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Invoice records' }))
  expect(screen.getByText('No invoice applications')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Invoice orders' }))
  expect(screen.getByLabelText('Invoice title')).toHaveValue('Example Company')
  expect(orderCheckbox).toBeChecked()

  const dialog = screen.getByRole('dialog', { name: 'Invoice application' })
  const scrollBody = dialog.querySelector('.overscroll-contain')
  expect(scrollBody).toContainElement(screen.getByLabelText('Invoice title'))
  expect(scrollBody).toContainElement(screen.getByRole('table'))
  expect(
    within(scrollBody as HTMLElement).getByRole('button', {
      name: 'Invoice records',
    })
  ).toBeVisible()
})

test('submits only eligible selected orders and deducts mandatory refunds', async () => {
  const withRefund: InvoiceEligibility = {
    ...eligibility,
    pending_refunds: [
      { id: 1, quota: 0, amount: 100, source: 'refund', created_at: 2 },
    ],
  }
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/invoice/eligibility') {
      return { data: { success: true, data: withRefund } }
    }
    return { data: { success: true, data: { items: [], total: 0 } } }
  })
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: {} } })
  renderDialog()
  await userEvent.click(
    await screen.findByRole('checkbox', {
      name: 'Select order AVAILABLE-ORDER',
    })
  )
  expect(
    screen.getByText('Net invoice amount').nextElementSibling
  ).toHaveTextContent('0.0009')
  await userEvent.type(
    screen.getByLabelText('Invoice title'),
    'Example Company'
  )
  await userEvent.type(
    screen.getByLabelText('Tax number / Unified Social Credit Code'),
    '91310000MA12345678'
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Submit invoice application' })
  )
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/invoice/', {
      title: 'Example Company',
      tax_id: '91310000MA12345678',
      top_up_ids: [1],
    })
  )
})

test('opens the invoice dialog from the real wallet and closes it with Escape', async () => {
  mockWalletRequests(true)
  await renderWallet()
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', { name: 'Invoice application' })
  )
  expect(
    await screen.findByRole('dialog', { name: 'Invoice application' })
  ).toBeVisible()
  expect(
    await screen.findByRole('checkbox', {
      name: 'Select order AVAILABLE-ORDER',
    })
  ).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})

test('hides the invoice entry in the real wallet when the admin disables it', async () => {
  mockWalletRequests(false)
  await renderWallet()
  expect(
    await screen.findByRole('button', { name: 'Order History' })
  ).toBeVisible()
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Invoice application' })
    ).not.toBeInTheDocument()
  )
})

test('places invoice application before order history and opens the named dialog', async () => {
  const onOpenInvoice = vi.fn()
  render(
    <RechargeFormCard
      topupInfo={null}
      presetAmounts={[]}
      selectedPreset={null}
      onSelectPreset={vi.fn()}
      topupAmount={0}
      onTopupAmountChange={vi.fn()}
      paymentAmount={0}
      calculating={false}
      onPaymentMethodSelect={vi.fn()}
      paymentLoading={null}
      redemptionCode=''
      onRedemptionCodeChange={vi.fn()}
      onRedeem={vi.fn()}
      redeeming={false}
      onOpenInvoice={onOpenInvoice}
      onOpenBilling={vi.fn()}
    />
  )
  const invoiceButton = screen.getByRole('button', {
    name: 'Invoice application',
  })
  const historyButton = screen.getByRole('button', { name: 'Order History' })
  expect(invoiceButton.parentElement).toHaveClass('grid-cols-2')
  expect(
    invoiceButton.compareDocumentPosition(historyButton) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  await userEvent.click(invoiceButton)
  expect(onOpenInvoice).toHaveBeenCalledOnce()
})

test('hides the wallet invoice entry when its module is disabled', () => {
  render(
    <RechargeFormCard
      topupInfo={null}
      presetAmounts={[]}
      selectedPreset={null}
      onSelectPreset={vi.fn()}
      topupAmount={0}
      onTopupAmountChange={vi.fn()}
      paymentAmount={0}
      calculating={false}
      onPaymentMethodSelect={vi.fn()}
      paymentLoading={null}
      redemptionCode=''
      onRedemptionCodeChange={vi.fn()}
      onRedeem={vi.fn()}
      redeeming={false}
      onOpenBilling={vi.fn()}
    />
  )
  expect(
    screen.queryByRole('button', { name: 'Invoice application' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Order History' })).toBeVisible()
})
