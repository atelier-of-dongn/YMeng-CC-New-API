import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

test('request mode saves zero without a manual ratio and retains the draft on failure', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: [
        {
          channel_id: 7,
          mode: 'manual',
          site_id: 0,
          groups: [],
          cost_mode: 'request',
          request_price: 1,
        },
      ],
    },
  })
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: false, message: 'price rejected' } })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ChannelsProvider>
        <OpenMonitor />
      </ChannelsProvider>
    </QueryClientProvider>
  )
  const price = await screen.findByRole('textbox', { name: 'Request price' })
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  fireEvent.change(price, { target: { value: '' } })
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  fireEvent.change(price, { target: { value: '0' } })
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/channel/upstream_cost/monitors/7',
      {
        mode: 'manual',
        manual_group: '',
        manual_ratio: null,
        cost_mode: 'request',
        request_price: 0,
      },
      expect.any(Object)
    )
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  )
  expect(screen.getByRole('textbox', { name: 'Request price' })).toHaveValue(
    '0'
  )
})
