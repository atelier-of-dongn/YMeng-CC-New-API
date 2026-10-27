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
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { CommonLogsFilterBar } from '../common-logs-filter-bar'
import { UsageLogsProvider } from '../usage-logs-provider'

function FilterFixture() {
  const table = useReactTable({
    data: [],
    columns: [],
    getCoreRowModel: getCoreRowModel(),
  })
  return (
    <UsageLogsProvider>
      <CommonLogsFilterBar table={table} />
    </UsageLogsProvider>
  )
}

async function renderFilter(role: number) {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'tester', role })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    let data: unknown = { quota: 0, rpm: 0, tpm: 0 }
    if (url === '/api/user/self/groups') data = {}
    else if (url === '/api/group/') data = []
    return { data: { success: true, data } }
  })
  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const logs = createRoute({
    getParentRoute: () => auth,
    path: '/usage-logs/$section',
    component: FilterFixture,
    validateSearch: (search: Record<string, unknown>) => search,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([logs])]),
    history: createMemoryHistory({ initialEntries: ['/usage-logs/common'] }),
  })
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('combobox', { name: 'Type' })
  await userEvent.click(screen.getByRole('button', { name: 'Expand' }))
  return router
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.setUser(null)
})

it('applies user, token, and IP filters for administrators', async () => {
  const router = await renderFilter(ROLE.ADMIN)

  await userEvent.type(screen.getByPlaceholderText('User ID'), '2')
  await userEvent.type(screen.getByPlaceholderText('Token ID'), '8')
  await userEvent.type(screen.getByPlaceholderText('IP Address'), '203.0.113.9')
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))

  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({
      userId: '2',
      tokenId: '8',
      ip: '203.0.113.9',
      page: 1,
    })
  )
})

it('hides the exact-match filters from regular users', async () => {
  await renderFilter(ROLE.USER)

  expect(screen.queryByPlaceholderText('User ID')).toBeNull()
  expect(screen.queryByPlaceholderText('Token ID')).toBeNull()
  expect(screen.queryByPlaceholderText('IP Address')).toBeNull()
  expect(screen.getByPlaceholderText('Token Name')).toBeVisible()
})
