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
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { ApiKeys } from '../index'
import { apiKeySchema } from '../types'

const clients: QueryClient[] = []
const endpoint =
  'https://gateway.example.com/teams/production/openai-compatible/v1'
const keys = Array.from({ length: 20 }, (_, index) =>
  apiKeySchema.parse({
    id: index + 1,
    name: `production-${index + 1}`,
    key: 'demo********1234',
    status: 1,
    remain_quota: 500000,
    used_quota: 0,
    unlimited_quota: false,
    expired_time: -1,
    created_time: 0,
    accessed_time: 0,
    group: 'default',
    model_limits_enabled: false,
  })
)

afterEach(() => {
  cleanup()
  for (const client of clients) client.clear()
  clients.length = 0
  localStorage.clear()
  vi.restoreAllMocks()
})

it.each([
  ['desktop', false],
  ['mobile', true],
] as const)(
  'keeps the %s key list in the remaining scrollable space below a long API URL',
  async (_viewport, mobile) => {
    localStorage.clear()
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: mobile && query === '(max-width: 640px)',
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }))
    vi.spyOn(api, 'get').mockImplementation(async (url) => {
      if (url.startsWith('/api/token/')) {
        return {
          data: { success: true, data: { items: keys, total: keys.length } },
        }
      }
      return { data: { success: true, data: { default: { ratio: 1 } } } }
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    client.setQueryData(['status'], {
      api_info_enabled: true,
      api_info: [{ url: endpoint, route: 'OpenAI-compatible' }],
    })
    clients.push(client)
    const root = createRootRoute()
    const auth = createRoute({
      getParentRoute: () => root,
      id: '_authenticated',
    })
    const keysRoute = createRoute({
      getParentRoute: () => auth,
      path: 'keys/',
      component: ApiKeys,
    })
    const router = createRouter({
      routeTree: root.addChildren([auth.addChildren([keysRoute])]),
      history: createMemoryHistory({ initialEntries: ['/keys/'] }),
    })
    await router.load()
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
    const lastKey = await screen.findByText('production-20')
    const url = screen.getByText(endpoint)
    const endpointPanel = screen
      .getByRole('button', { name: 'Copy URL' })
      .closest('.rounded-lg')
    const content = endpointPanel?.parentElement

    expect(content).toHaveClass('flex', 'h-full', 'min-h-0', 'flex-col')
    expect(endpointPanel).toHaveClass('shrink-0')
    expect(content?.lastElementChild).toHaveClass('min-h-0', 'flex-1')
    expect(url).toHaveAttribute('title', endpoint)
    expect(url).toHaveClass('break-all', 'sm:truncate')

    if (mobile) {
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      expect(lastKey.closest('.overflow-y-auto')).toHaveClass(
        'min-h-0',
        'flex-1'
      )
    } else {
      expect(screen.getByRole('table').parentElement).toHaveClass(
        'min-h-0',
        'flex-1',
        'overflow-auto'
      )
    }
    expect(
      screen.getByRole('button', { name: 'Go to next page' })
    ).toBeInTheDocument()
  }
)
