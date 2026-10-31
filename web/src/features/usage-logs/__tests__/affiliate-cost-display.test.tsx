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
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter } from 'axios'
import { afterEach, expect, test } from 'vitest'

import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { formatLogQuota, formatPercent } from '@/lib/format'

import { useCommonLogsColumns } from '../components/columns/common-logs-columns'
import {
  AffiliateCostLogCell,
  ProfitLogCell,
} from '../components/columns/upstream-cost-cells'
import { UpstreamCostStats } from '../components/upstream-cost-stats'
import {
  UsageLogsProvider,
  useUsageLogsContext,
} from '../components/usage-logs-provider'
import { usageLogSchema, type UsageLog } from '../data/schema'
import type { UpstreamCostStatistics } from '../types'

const originalAdapter = api.defaults.adapter
const clients: QueryClient[] = []
afterEach(() => {
  api.defaults.adapter = originalAdapter
  clients.forEach((client) => client.clear())
  clients.length = 0
  localStorage.clear()
})

function Controls() {
  const context = useUsageLogsContext()
  return (
    <>
      <Button
        type='button'
        onClick={() => context.setSensitiveVisible(!context.sensitiveVisible)}
      >
        Toggle amounts
      </Button>
      <Button
        type='button'
        onClick={() =>
          context.setInternalAccounting(!context.internalAccounting)
        }
      >
        Toggle accounting
      </Button>
    </>
  )
}

function log(affiliateCost: number | null | undefined): UsageLog {
  return usageLogSchema.parse({
    id: 1,
    user_id: 1,
    created_at: 1,
    type: 2,
    content: '',
    quota: 1000,
    affiliate_cost: affiliateCost,
    upstream_cost: { status: 2, cost_quota: 800, internal_use: true },
  })
}

function CostTable(props: { admin: boolean; log: UsageLog }) {
  const columns = useCommonLogsColumns(props.admin, false)
  const table = useReactTable({
    data: [props.log],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })
  return (
    <table>
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers
              .filter((header) =>
                [
                  'upstream_amount',
                  'affiliate_cost',
                  'upstream_profit',
                ].includes(header.column.id)
              )
              .map((header) => (
                <th key={header.id}>
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext()
                  )}
                </th>
              ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row
              .getVisibleCells()
              .filter((cell) =>
                [
                  'upstream_amount',
                  'affiliate_cost',
                  'upstream_profit',
                ].includes(cell.column.id)
              )
              .map((cell) => (
                <td key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

test('admin rebate column follows upstream amount and precedes profit; self view omits costs', () => {
  const rendered = render(
    <UsageLogsProvider>
      <CostTable admin log={log(250)} />
    </UsageLogsProvider>
  )
  expect(
    screen.getAllByRole('columnheader').map((header) => header.textContent)
  ).toEqual(['Upstream Amount', 'Affiliate Rebate', 'Profit/Loss'])
  expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
    formatLogQuota(800),
    formatLogQuota(250),
    formatLogQuota(-50),
  ])
  rendered.rerender(
    <UsageLogsProvider>
      <CostTable admin={false} log={log(250)} />
    </UsageLogsProvider>
  )
  expect(
    screen.queryByRole('columnheader', { name: 'Affiliate Rebate' })
  ).not.toBeInTheDocument()
})

test.each([0, 0.123456, null, undefined])(
  'rebate cell distinguishes known value %s from unknown',
  (rebate) => {
    render(
      <UsageLogsProvider>
        <AffiliateCostLogCell log={log(rebate)} />
      </UsageLogsProvider>
    )
    expect(
      screen.getByText(rebate == null ? '-' : formatLogQuota(rebate))
    ).toBeVisible()
  }
)

test('rebate remains visible when upstream cost is unknown but profit stays unknown', () => {
  const item = { ...log(25), upstream_cost: undefined }
  render(
    <UsageLogsProvider>
      <AffiliateCostLogCell log={item} />
      <ProfitLogCell log={item} />
    </UsageLogsProvider>
  )
  expect(screen.getByText(formatLogQuota(25))).toBeVisible()
  expect(screen.getByText('-')).toBeVisible()
})

test('rebate respects amount masking and internal accounting deducts both costs', async () => {
  render(
    <UsageLogsProvider>
      <Controls />
      <AffiliateCostLogCell log={log(25)} />
      <ProfitLogCell log={log(25)} />
    </UsageLogsProvider>
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Toggle amounts' }))
  expect(screen.getByText('••••')).toBeVisible()
  expect(screen.queryByText(formatLogQuota(25))).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Toggle accounting' }))
  expect(screen.getByText(formatLogQuota(-825))).toBeVisible()
})

const totals: UpstreamCostStatistics = {
  revenue: 800,
  cost: 600,
  affiliate_cost: 240,
  covered_quota: 800,
  internal_cost: 0,
  internal_estimated_cost: 0,
  matched: 1,
  estimated: 0,
  unknown: 1,
  internal_unknown: 0,
}

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
        <TooltipProvider>
          <Controls />
          <UpstreamCostStats totalQuota={1000} />
        </TooltipProvider>
      </UsageLogsProvider>
    ),
  })
  const router = createRouter({
    routeTree: root.addChildren([authenticated.addChildren([section])]),
    history: createMemoryHistory({ initialEntries: ['/usage-logs/all'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return client
}

test('summary displays rebate, adjusted profit and margin, unchanged coverage and masking', async () => {
  const adapter: AxiosAdapter = async (config) => ({
    config,
    status: 200,
    statusText: 'OK',
    headers: {},
    data: { success: true, data: totals },
  })
  api.defaults.adapter = adapter
  await renderStats()
  expect(await screen.findByText('Affiliate Rebate')).toBeVisible()
  expect(screen.getByText(formatLogQuota(240))).toBeVisible()
  expect(screen.getByText(formatLogQuota(-40))).toBeVisible()
  expect(screen.getByText(formatPercent(-5))).toBeVisible()
  expect(screen.getByText(formatPercent(80))).toBeVisible()
  const user = userEvent.setup()
  await user.hover(screen.getByRole('button', { name: /Coverage/ }))
  expect(
    await screen.findByText(
      'Profit deducts upstream cost and affiliate rebates for usage with a known upstream cost only'
    )
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Toggle amounts' }))
  expect(screen.getAllByText('••••')).toHaveLength(4)
  expect(screen.queryByText(formatLogQuota(240))).not.toBeInTheDocument()
})

test('summary does not show a fixed money icon on amounts or shares', async () => {
  const adapter: AxiosAdapter = async (config) => ({
    config,
    status: 200,
    statusText: 'OK',
    headers: {},
    data: { success: true, data: totals },
  })
  api.defaults.adapter = adapter
  await renderStats()
  await screen.findByText('Affiliate Rebate')
  const iconOf = (label: string) =>
    screen
      .getByText(label)
      .closest('[data-slot=stat-badge]')
      ?.querySelector('[data-slot=stat-money-icon]')
  for (const label of [
    'Revenue',
    'Upstream Cost',
    'Affiliate Rebate',
    'Profit',
    'Gross Margin',
    'Coverage',
  ]) {
    expect(iconOf(label)).toBeNull()
  }
})

test.each(['business', 'network'])(
  'failed %s refresh hides cached statistics',
  async (failure) => {
    let failed = false
    const adapter: AxiosAdapter = async (config) => {
      if (failed && failure === 'network') throw new Error('offline')
      return {
        config,
        status: 200,
        statusText: 'OK',
        headers: {},
        data: failed
          ? { success: false, message: 'ambiguous rebate' }
          : { success: true, data: totals },
      }
    }
    api.defaults.adapter = adapter
    const client = await renderStats()
    expect(await screen.findByText('Affiliate Rebate')).toBeVisible()
    failed = true
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['usage-logs-stats'] })
    })
    await waitFor(() =>
      expect(screen.queryByText('Affiliate Rebate')).not.toBeInTheDocument()
    )
    expect(screen.queryByText('Profit')).not.toBeInTheDocument()
    expect(screen.queryByText('Revenue')).not.toBeInTheDocument()
  }
)
