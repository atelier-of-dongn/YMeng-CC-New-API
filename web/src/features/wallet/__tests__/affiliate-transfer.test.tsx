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
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { formatQuota } from '@/lib/format'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { Wallet } from '../index'

const clients: QueryClient[] = []

beforeEach(() => {
  localStorage.clear()
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
})

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
  localStorage.clear()
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
})

async function renderWallet(availableQuota: number, transferSucceeds = true) {
  let remainingQuota = availableQuota
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    let data: unknown
    switch (url) {
      case '/api/user/self':
        data = {
          id: 1,
          username: 'referrer',
          quota: availableQuota - remainingQuota,
          used_quota: 0,
          request_count: 0,
          aff_quota: 0,
          aff_history_quota: 0,
          aff_count: 0,
          group: 'default',
        }
        break
      case '/api/user/affiliate/summary':
        data = {
          available_quota: remainingQuota,
          total_quota: availableQuota,
          invitee_count: 1,
          commission_count: 1,
          pending_remainder: 0,
          rate_percent: 10,
          enabled: true,
          aff_code: 'referral',
        }
        break
      case '/api/user/aff':
        data = 'referral'
        break
      case '/api/user/topup/info':
        data = { min_topup: 1, pay_methods: [], amount_options: [] }
        break
      case '/api/subscription/plans':
        data = []
        break
      case '/api/subscription/self':
        data = { subscriptions: [], all_subscriptions: [] }
        break
      case '/api/status':
        data = { price: 1 }
        break
      default:
        throw new Error(`Unexpected GET ${url}`)
    }
    return { data: { success: true, data } }
  })
  const post = vi.spyOn(api, 'post').mockImplementation(async (url, body) => {
    if (url === '/api/user/amount') {
      return { data: { success: true, data: '1' } }
    }
    if (url !== '/api/user/aff_transfer') {
      throw new Error(`Unexpected POST ${url}`)
    }
    if (transferSucceeds) {
      remainingQuota -= (body as { quota: number }).quota
    }
    return {
      data: {
        success: transferSucceeds,
        message: transferSucceeds ? 'Transfer successful' : 'Transfer failed',
      },
    }
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
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
  await screen.findByRole('button', { name: 'Transfer to Balance' })
  return { get, post }
}

it('uses the commission summary in the transfer dialog when self has no invite quota', async () => {
  const user = userEvent.setup()
  const { post } = await renderWallet(1000000)
  await user.click(screen.getByRole('button', { name: 'Transfer to Balance' }))
  const dialog = await screen.findByRole('dialog', { name: 'Transfer Rewards' })

  expect(within(dialog).getByText(formatQuota(1000000))).toBeInTheDocument()
  expect(within(dialog).getByRole('spinbutton')).toHaveValue(1)
  expect(
    within(dialog).getByRole('button', { name: /^Transfer$/ })
  ).toBeEnabled()
  await user.click(within(dialog).getByRole('button', { name: /^Transfer$/ }))

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/user/aff_transfer', {
      quota: 500000,
    })
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  await user.click(screen.getByRole('button', { name: 'Transfer to Balance' }))
  const reopened = await screen.findByRole('dialog', {
    name: 'Transfer Rewards',
  })
  expect(within(reopened).getByRole('spinbutton')).toHaveAttribute('max', '1')
  expect(
    within(reopened).getByText(formatQuota(500000), { selector: '.text-2xl' })
  ).toBeInTheDocument()
})

it('disables transfer when the commission balance is below the minimum', async () => {
  const user = userEvent.setup()
  const { post } = await renderWallet(250000)
  await user.click(screen.getByRole('button', { name: 'Transfer to Balance' }))
  const dialog = await screen.findByRole('dialog', { name: 'Transfer Rewards' })
  expect(within(dialog).getByText(formatQuota(250000))).toBeInTheDocument()
  expect(
    within(dialog).getByRole('button', { name: /^Transfer$/ })
  ).toBeDisabled()
  expect(post).not.toHaveBeenCalledWith(
    '/api/user/aff_transfer',
    expect.anything()
  )
})

it('keeps the dialog and available commission balance after a rejected transfer', async () => {
  const user = userEvent.setup()
  await renderWallet(1000000, false)
  await user.click(screen.getByRole('button', { name: 'Transfer to Balance' }))
  const dialog = await screen.findByRole('dialog', { name: 'Transfer Rewards' })
  await user.click(within(dialog).getByRole('button', { name: /^Transfer$/ }))
  await waitFor(() =>
    expect(
      within(dialog).getByRole('button', { name: /^Transfer$/ })
    ).toBeEnabled()
  )
  expect(dialog).toBeInTheDocument()
  expect(within(dialog).getByText(formatQuota(1000000))).toBeInTheDocument()
})
