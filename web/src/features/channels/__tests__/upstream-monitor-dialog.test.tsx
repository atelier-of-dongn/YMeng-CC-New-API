import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { ChannelsProvider, useChannels } from '../components/channels-provider'
import { UpstreamMonitorDialog } from '../components/dialogs/upstream-monitor-dialog'
import type { Channel, UpstreamMonitorView } from '../types'

function OpenMonitor() {
  const setCurrentRow = useChannels().setCurrentRow
  useEffect(() => {
    setCurrentRow({ id: 7, name: 'Upstream channel' } as Channel)
  }, [setCurrentRow])
  return <UpstreamMonitorDialog open onOpenChange={() => {}} />
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('when detection completes while the dialog is open, it displays the upstream result', async () => {
  vi.useFakeTimers()
  let recognized = false
  const pending: Partial<UpstreamMonitorView> = {
    channel_id: 7,
    mode: 'auto',
    site_id: 3,
    site_status: 'pending',
    site_base_url: 'https://upstream.example.com',
    pricing_status: '',
    groups: [],
  }
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/channel/upstream_cost/monitors') {
      return {
        data: {
          success: true,
          data: [
            {
              ...pending,
              site_status: recognized ? 'newapi' : 'pending',
              site_name: recognized ? 'Upstream' : '',
            },
          ],
        },
      }
    }
    return { data: { success: true, data: [] } }
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ChannelsProvider>
        <OpenMonitor />
      </ChannelsProvider>
    </QueryClientProvider>
  )
  await act(async () => {
    await vi.waitFor(() => expect(screen.getByText('Detecting')).toBeVisible())
  })
  recognized = true
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000)
  })
  await act(async () => {
    await vi.waitFor(() => expect(screen.getByText('New API')).toBeVisible())
  })
  expect(
    get.mock.calls.filter(
      ([url]) => url === '/api/channel/upstream_cost/monitors'
    ).length
  ).toBeGreaterThan(1)
})
