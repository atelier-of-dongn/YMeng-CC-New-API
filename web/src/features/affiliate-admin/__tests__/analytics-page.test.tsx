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
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { AffiliateAdminAnalytics } from '..'

vi.mock('@visactor/react-vchart', () => ({ VChart: () => null }))

type RequestConfig = {
  params?: Record<string, unknown>
  signal?: AbortSignal
  disableDuplicate?: boolean
}

let client: QueryClient
let commissionRequests: Record<string, unknown>[]
let requestConfigs: Record<string, RequestConfig[]>
let commissionTotal: number
let holdRequests: boolean
let releaseRequests: (() => void) | undefined

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  commissionRequests = []
  requestConfigs = {}
  commissionTotal = 45
  holdRequests = false
  releaseRequests = undefined
  vi.spyOn(api, 'get').mockImplementation(async (url, config) => {
    const requestConfig = (config as RequestConfig | undefined) ?? {}
    const params = requestConfig.params ?? {}
    requestConfigs[url] = [...(requestConfigs[url] ?? []), requestConfig]
    if (holdRequests) {
      await new Promise<void>((resolve) => {
        releaseRequests = resolve
      })
    }
    switch (url) {
      case '/api/affiliate/analytics/admin/overview':
        return {
          data: {
            success: true,
            data: {
              overview: {
                referral_count: 1234,
                active_inviter_count: 56,
                commission_count: 78,
                credited_quota: 0,
              },
              trend: [
                {
                  date: '2026-09-30',
                  referral_count: 34,
                  commission_count: 78,
                  credited_quota: 0,
                },
              ],
            },
          },
        }
      case '/api/affiliate/analytics/admin/rankings':
        return {
          data: {
            success: true,
            data: {
              items: [
                {
                  inviter_id: 7,
                  username: 'top-inviter',
                  display_name: 'Top Inviter',
                  referral_count: 42,
                  commission_count: 3,
                  credited_quota: 0,
                },
              ],
              total: 1,
            },
          },
        }
      case '/api/affiliate/analytics/admin/commissions':
        commissionRequests.push(params)
        return {
          data: {
            success: true,
            data: {
              items:
                commissionTotal === 0
                  ? []
                  : [
                      {
                        id: 1,
                        inviter_id: 7,
                        inviter_name: 'Top Inviter',
                        invitee_id: 9,
                        invitee_name: 'New User',
                        model_name: 'model-a',
                        billing_source: 'wallet',
                        consumed_quota: 100,
                        rate_percent: 5,
                        reward_amount: 5,
                        credited_quota: 5,
                        status: 'completed',
                        created_at: 1_790_000_000,
                      },
                    ],
              total: commissionTotal,
            },
          },
        }
      default:
        throw new Error(`Unexpected request: ${url}`)
    }
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  vi.restoreAllMocks()
})

async function renderPage() {
  const router = createRouter({
    routeTree: createRootRoute({ component: AffiliateAdminAnalytics }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('referral analytics page', () => {
  it('shows site-wide totals, inviter ranking, and commission rows when data loads', async () => {
    await renderPage()

    expect(await screen.findByText('1,234')).toBeInTheDocument()
    expect(screen.getByText('56')).toBeInTheDocument()
    expect(screen.getAllByText('Top Inviter').length).toBeGreaterThan(0)
    expect(await screen.findByText('New User')).toBeInTheDocument()
    expect(commissionRequests[0]).toMatchObject({ page: 1, page_size: 20 })
    expect(commissionRequests[0].status).toBeUndefined()
  })

  it('requests the first page again when the date range changes after paging', async () => {
    const user = userEvent.setup()
    await renderPage()
    await screen.findByText('New User')

    await user.click(screen.getByRole('button', { name: 'Go to next page' }))
    await waitFor(() =>
      expect(commissionRequests.at(-1)).toMatchObject({ page: 2 })
    )

    await user.click(screen.getByRole('tab', { name: '7 Days' }))
    await waitFor(() => {
      const last = commissionRequests.at(-1)
      expect(last).toMatchObject({ page: 1 })
      expect(Number(last?.end_timestamp) - Number(last?.start_timestamp)).toBe(
        7 * 24 * 60 * 60
      )
    })
  })

  it('requests the last 24 hours for every panel when 1 Day is selected', async () => {
    const user = userEvent.setup()
    await renderPage()
    await screen.findByText('New User')

    await user.click(screen.getByRole('tab', { name: '1 Day' }))
    await waitFor(() => {
      for (const url of [
        '/api/affiliate/analytics/admin/overview',
        '/api/affiliate/analytics/admin/rankings',
        '/api/affiliate/analytics/admin/commissions',
      ]) {
        const params = requestConfigs[url]?.at(-1)?.params
        expect(
          Number(params?.end_timestamp) - Number(params?.start_timestamp)
        ).toBe(24 * 60 * 60)
      }
      expect(commissionRequests.at(-1)).toMatchObject({ page: 1 })
    })
  })

  it('cancels an obsolete range request when filters change', async () => {
    const user = userEvent.setup()
    holdRequests = true
    const view = await renderPage()
    await waitFor(() => expect(releaseRequests).toBeDefined())
    const initialRequests = Object.values(requestConfigs).map(
      (configs) => configs[0]
    )
    expect(initialRequests).toHaveLength(3)

    await user.click(screen.getByRole('tab', { name: '1 Day' }))
    for (const config of initialRequests) {
      expect(config.signal?.aborted).toBe(true)
      expect(config.disableDuplicate).toBe(true)
    }
    releaseRequests?.()
    await screen.findByText('New User')
    view.unmount()
  })

  it('reuses cached commissions when the previous page is reopened', async () => {
    const user = userEvent.setup()
    await renderPage()
    await screen.findByText('New User')
    expect(commissionRequests).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Go to next page' }))
    await waitFor(() => expect(commissionRequests).toHaveLength(2))
    await user.click(
      screen.getByRole('button', { name: 'Go to previous page' })
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Go to first page' })
      ).toBeDisabled()
    )
    expect(commissionRequests).toHaveLength(2)
  })

  it('shows the empty state when no commission records match', async () => {
    commissionTotal = 0
    await renderPage()

    expect(
      await screen.findByText('No commission records found')
    ).toBeInTheDocument()
  })
})
