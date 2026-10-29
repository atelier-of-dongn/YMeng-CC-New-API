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
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { render, screen } from '@testing-library/react'
import type { AxiosAdapter } from 'axios'
import { afterEach, expect, test } from 'vitest'

import { api } from '@/lib/api'

import { CacheRateRing } from '../components/cache-rate-ring'
import { useCommonLogsColumns } from '../components/columns/common-logs-columns'
import { CommonLogsStats } from '../components/common-logs-stats'
import { UsageLogsProvider } from '../components/usage-logs-provider'
import { usageLogSchema, type UsageLog } from '../data/schema'

const originalAdapter = api.defaults.adapter
const clients: QueryClient[] = []
afterEach(() => {
  api.defaults.adapter = originalAdapter
  clients.forEach((client) => client.clear())
  clients.length = 0
  localStorage.clear()
})

function consumeLog(promptTokens: number, other: object): UsageLog {
  return usageLogSchema.parse({
    id: 1,
    user_id: 1,
    created_at: 1,
    type: 2,
    content: '',
    prompt_tokens: promptTokens,
    completion_tokens: 10,
    other: JSON.stringify(other),
  })
}

function CacheRateColumn(props: { log: UsageLog }) {
  const columns = useCommonLogsColumns(false, false)
  const table = useReactTable({
    data: [props.log],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })
  const header = table
    .getFlatHeaders()
    .find((item) => item.column.id === 'cache_rate')
  const cell = table
    .getRowModel()
    .rows[0].getVisibleCells()
    .find((item) => item.column.id === 'cache_rate')
  if (!header || !cell) return null
  return (
    <table>
      <thead>
        <tr>
          <th>
            {flexRender(header.column.columnDef.header, header.getContext())}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
        </tr>
      </tbody>
    </table>
  )
}

test.each([
  [
    'cache read over total input for non-Anthropic usage with cache writes',
    51404,
    {
      cache_tokens: 50519,
      cache_creation_tokens: 883,
      usage_semantic: 'openai',
    },
    '98.28%',
  ],
  [
    'cache read over input plus cache read for Anthropic usage',
    300,
    { cache_tokens: 100, cache_creation_tokens: 0, usage_semantic: 'anthropic' },
    '25%',
  ],
  [
    'cache read over input plus cache read when a cache write field exists',
    300,
    { cache_tokens: 100, cache_creation_tokens: 0 },
    '25%',
  ],
  [
    'the same share whatever was written to the cache',
    300,
    {
      cache_tokens: 100,
      cache_creation_tokens: 9000,
      cache_creation_tokens_5m: 9000,
    },
    '25%',
  ],
  [
    'cache read over input when no cache write field exists',
    1000,
    { cache_tokens: 900 },
    '90%',
  ],
  ['no cache read', 300, {}, '0%'],
  ['zero input without a cache write field', 0, { cache_tokens: 0 }, '0%'],
  [
    'invalid negative cache reads',
    300,
    { cache_tokens: -100, usage_semantic: 'openai' },
    '0%',
  ],
  [
    'anomalous input that already includes cache reads',
    300,
    { cache_tokens: 900, usage_semantic: 'openai' },
    '100%',
  ],
  [
    'zero input and cache read with a cache write field',
    0,
    { cache_creation_tokens: 0 },
    '0%',
  ],
])('self view cache rate column shows %s', (_case, prompt, other, rate) => {
  render(
    <UsageLogsProvider>
      <CacheRateColumn log={consumeLog(prompt, other)} />
    </UsageLogsProvider>
  )
  expect(screen.getByRole('columnheader')).toHaveTextContent('Cache Rate')
  const ring = screen.getByRole('progressbar', { name: 'Cache Rate' })
  expect(ring).toHaveAttribute('aria-valuetext', rate)
  expect(ring).toHaveTextContent(rate)
})

test.each([
  [0, 'empty', 0, '0%'],
  [0.01, 'low', 1, '1%'],
  [0.6, 'low', 60, '60%'],
  [0.6001, 'medium', 60.01, '60.01%'],
  [0.9, 'medium', 90, '90%'],
  [0.9001, 'high', 90.01, '90.01%'],
  [1, 'high', 100, '100%'],
])('cache rate ring at %s uses the %s band', (rate, band, ariaValue, text) => {
  render(<CacheRateRing rate={rate} label='Cache Rate' />)
  const ring = screen.getByRole('progressbar', { name: 'Cache Rate' })
  expect(ring).toHaveAttribute('data-cache-rate-band', band)
  expect(ring).toHaveAttribute('aria-valuenow', String(ariaValue))
  expect(ring).toHaveAttribute('aria-valuetext', text)
  expect(ring).toHaveTextContent(text)
  const progress = ring.querySelector('[data-cache-rate-progress]')
  if (rate === 0) {
    expect(progress).not.toBeInTheDocument()
    expect(ring.querySelector('[data-cache-rate-track]')).toBeInTheDocument()
  } else {
    expect(progress).toBeInTheDocument()
    const colorClass = {
      low: 'text-destructive',
      medium: 'text-warning',
      high: 'text-success',
    }[band]
    expect(progress).toHaveClass(colorClass as string)
  }
})

async function renderStats() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  const root = createRootRoute()
  const authenticated = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
  })
  const section = createRoute({
    getParentRoute: () => authenticated,
    path: '/usage-logs/$section',
    component: () => (
      <UsageLogsProvider>
        <CommonLogsStats />
      </UsageLogsProvider>
    ),
  })
  const router = createRouter({
    routeTree: root.addChildren([authenticated.addChildren([section])]),
    history: createMemoryHistory({ initialEntries: ['/usage-logs/common'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

test('ordinary user summary shows the token-weighted cache hit rate from self statistics', async () => {
  const requested: string[] = []
  const adapter: AxiosAdapter = async (config) => {
    requested.push(config.url ?? '')
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {
        success: true,
        data: { quota: 0, rpm: 0, tpm: 0, cache_rate: 0.25005 },
      },
    }
  }
  api.defaults.adapter = adapter
  await renderStats()
  expect(await screen.findByText('Cache Hit Rate')).toBeVisible()
  expect(screen.getByText('25.01%')).toBeVisible()
  expect(requested).toEqual([
    expect.stringMatching(/^\/api\/log\/self\/stat\?/),
  ])
})

test('summary marks only the usage amount with a money icon', async () => {
  const adapter: AxiosAdapter = async (config) => ({
    config,
    status: 200,
    statusText: 'OK',
    headers: {},
    data: { success: true, data: { quota: 500, rpm: 3, tpm: 9 } },
  })
  api.defaults.adapter = adapter
  await renderStats()
  const badgeOf = async (label: string) =>
    (await screen.findByText(label)).closest('[data-slot=stat-badge]')
  const iconOf = async (label: string) =>
    (await badgeOf(label))?.querySelector('[data-slot=stat-money-icon]')
  expect(await iconOf('Usage')).toHaveAttribute('aria-hidden', 'true')
  for (const label of ['RPM', 'TPM', 'Cache Hit Rate']) {
    expect(await iconOf(label)).toBeNull()
  }
})
