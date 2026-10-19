import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { SummaryCards } from '@/features/dashboard/components/overview/summary-cards'
import { api } from '@/lib/api'
import { formatQuota } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { Wallet } from '../index'

const clients: QueryClient[] = []
beforeEach(() => {
  localStorage.clear()
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'buyer',
    role: 1,
    quota: 1000000,
  })
})
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
  localStorage.clear()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
})

it('refreshes both the wallet balance and the shared dashboard balance after a store order completes', async () => {
  let settled = false
  vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url === '/api/user/catfk/quote') {
      return {
        data: {
          success: true,
          data: {
            quote_id: 'q1',
            amount: 72,
            currency: 'CNY',
            topup_amount: 10,
          },
        },
      }
    }
    if (url === '/api/user/catfk/pay') {
      return {
        data: {
          success: true,
          data: {
            trade_no: 'settled-order',
            status: 'pending',
            payment_qr_code: 'https://qr.alipay.com/upx-code',
          },
        },
      }
    }
    throw new Error(`Unexpected POST ${url}`)
  })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    let data: unknown
    switch (url) {
      case '/api/user/self':
        data = {
          id: 1,
          username: 'buyer',
          role: 1,
          quota: settled ? 6000000 : 1000000,
          used_quota: 0,
          request_count: 0,
          group: 'default',
        }
        break
      case '/api/user/catfk/orders/settled-order':
        settled = true
        data = {
          trade_no: 'settled-order',
          status: 'completed',
        }
        break
      case '/api/user/topup/info':
        data = {
          min_topup: 1,
          pay_methods: [],
          amount_options: [10],
          catfk: {
            enabled: true,
            available: true,
            products: [{ id: 'ten', name: 'Ten dollars', amount: 10 }],
            channels: [{ id: '1', name: 'Alipay' }],
          },
        }
        break
      case '/api/user/affiliate/summary':
        data = {
          available_quota: 0,
          total_quota: 0,
          invitee_count: 0,
          commission_count: 0,
          pending_remainder: 0,
          rate_percent: 10,
          enabled: false,
          aff_code: '',
        }
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
      case '/api/data/self':
        data = []
        break
      case '/api/status':
        data = { price: 1 }
        break
      default:
        throw new Error(`Unexpected GET ${url}`)
    }
    return { data: { success: true, data } }
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  const root = createRootRoute()
  const walletRoute = createRoute({
    getParentRoute: () => root,
    path: '/wallet',
    component: () => (
      <>
        <Wallet />
        <section aria-label='Dashboard balance'>
          <SummaryCards />
        </section>
      </>
    ),
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

  const user = userEvent.setup()
  const custom = await screen.findByRole('spinbutton', {
    name: 'Custom Amount',
  })
  expect(custom).toHaveValue(null)
  expect(custom).toHaveAttribute('placeholder', 'Minimum 1')
  await user.click(await screen.findByRole('button', { name: /^10 Pay/ }))
  await user.click(screen.getByRole('button', { name: /Alipay/ }))
  await user.type(
    await screen.findByRole('textbox', { name: /Contact method/ }),
    '12345'
  )
  await user.click(screen.getByRole('button', { name: 'Confirm Payment' }))
  await waitFor(() =>
    expect(screen.getAllByText(formatQuota(6000000))).toHaveLength(2)
  )
  const success = screen.getByRole('dialog', { name: 'Payment successful' })
  await user.click(within(success).getByRole('button', { name: 'Done' }))
  expect(
    within(screen.getByRole('region', { name: 'Dashboard balance' })).getByText(
      formatQuota(6000000)
    )
  ).toBeVisible()
  expect(
    Object.keys(localStorage).filter((key) => key.startsWith('wallet:catfk'))
  ).toEqual([])
})
