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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { Route as RedemptionsRoute } from '@/routes/_authenticated/redemption-codes/index'
import { useAuthStore } from '@/stores/auth-store'

import { RedemptionsProvider } from '../redemptions-provider'
import { RedemptionsTable } from '../redemptions-table'

const code = '0a1b2c3d4e5f60718293a4b5c6d7e8f9'
const listUrl = '/api/redemption/?p=1&page_size=20'
const searchUrl = `/api/redemption/search?keyword=&key=${code}&p=1&page_size=20`
const clients: QueryClient[] = []

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  localStorage.clear()
  useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role: 100 })
})

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
  localStorage.clear()
  useAuthStore.getState().auth.reset()
})

async function renderRedemptions(initialEntry = '/redemption-codes/') {
  const get = vi.spyOn(api, 'get').mockImplementation(async () => ({
    data: {
      success: true,
      data: {
        items: [
          {
            id: 2,
            user_id: 1,
            name: 'alpha',
            key: code,
            status: 1,
            quota: 100,
            created_time: 1,
            redeemed_time: 0,
            expired_time: 0,
            used_user_id: 0,
          },
        ],
        total: 1,
      },
    },
  }))
  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const redemptions = createRoute({
    getParentRoute: () => auth,
    path: 'redemption-codes/',
    validateSearch: RedemptionsRoute.options.validateSearch,
    component: () => (
      <TooltipProvider>
        <RedemptionsProvider>
          <RedemptionsTable />
        </RedemptionsProvider>
      </TooltipProvider>
    ),
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([redemptions])]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByText('alpha')
  return { get, router }
}

it('searches by exact redemption code and clears the filter on reset', async () => {
  const user = userEvent.setup()
  const { get, router } = await renderRedemptions()
  expect(get).toHaveBeenCalledWith(listUrl)

  const input = screen.getByRole('textbox', {
    name: 'Filter by redemption code...',
  })
  await user.type(input, code)

  await waitFor(() => expect(get).toHaveBeenLastCalledWith(searchUrl))
  expect(router.state.location.search).toMatchObject({ key: code })

  await user.click(screen.getByRole('button', { name: /^Reset/ }))

  await waitFor(() => expect(get).toHaveBeenLastCalledWith(listUrl))
  expect(router.state.location.search).not.toHaveProperty('key')
  expect(input).toHaveValue('')
})

it('restores the redemption code filter from the page URL on load', async () => {
  const { get } = await renderRedemptions(`/redemption-codes/?key=${code}`)

  expect(get).toHaveBeenCalledWith(searchUrl)
  expect(
    screen.getByRole('textbox', { name: 'Filter by redemption code...' })
  ).toHaveValue(code)
})

it('returns to the first page when the redemption code filter is applied', async () => {
  const user = userEvent.setup()
  const { get } = await renderRedemptions('/redemption-codes/?page=3')

  await user.type(
    screen.getByRole('textbox', { name: 'Filter by redemption code...' }),
    code
  )

  await waitFor(() => expect(get).toHaveBeenLastCalledWith(searchUrl))
})
