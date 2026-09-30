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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { ChannelsProvider, useChannels } from '../components/channels-provider'
import { UpstreamGroupCell } from '../components/upstream-group-cell'
import { UpstreamMonitorProvider } from '../components/upstream-monitor-provider'
import type { Channel, UpstreamMonitorView } from '../types'

function monitor(
  overrides: Partial<UpstreamMonitorView> & { channel_id: number }
): UpstreamMonitorView {
  return {
    mode: 'auto',
    site_id: 7,
    site_name: 'Upstream',
    site_base_url: 'https://upstream.example.com',
    site_status: 'newapi',
    pricing_status: 'ok',
    effective_group: '',
    detected_group: '',
    manual_group: '',
    group_mismatch: false,
    group_ratio: 0,
    prev_group_ratio: 0,
    ratio_source: '',
    ratio_changed_at: 0,
    cost_status: 'unknown',
    inverted_models: [],
    unknown_models: [],
    mixed_models: [],
    balance_unlimited: false,
    key_groups: [],
    last_error: '',
    groups: [],
    updated_at: 0,
    ...overrides,
  }
}

function OpenDialogProbe() {
  const channels = useChannels()
  return (
    <output aria-label='Open dialog'>
      {channels.open ? `${channels.open}:${channels.currentRow?.id}` : 'none'}
    </output>
  )
}

function renderGroupCells(ids: number[], monitors: UpstreamMonitorView[]) {
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValue({ data: { success: true, data: monitors } })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ChannelsProvider>
        <UpstreamMonitorProvider channelIds={ids}>
          {ids.map((id) => (
            <div key={id} data-testid={`channel-${id}`}>
              <UpstreamGroupCell channel={{ id } as Channel} />
            </div>
          ))}
        </UpstreamMonitorProvider>
        <OpenDialogProbe />
      </ChannelsProvider>
    </QueryClientProvider>
  )
  return get
}

afterEach(() => {
  vi.restoreAllMocks()
})

test('requests monitors for the visible channel ids in one call', async () => {
  const get = renderGroupCells([3, 8], [monitor({ channel_id: 3 })])

  await screen.findByRole('button', { name: 'Select group' })

  expect(get).toHaveBeenCalledWith('/api/channel/upstream_cost/monitors', {
    params: { ids: '3,8' },
  })
})

test('opens the monitor dialog from the Select group shortcut when a New API site reports no group', async () => {
  renderGroupCells([3], [monitor({ channel_id: 3 })])

  await userEvent.click(
    await screen.findByRole('button', { name: 'Select group' })
  )

  expect(screen.getByRole('status', { name: 'Open dialog' })).toHaveTextContent(
    'upstream-monitor:3'
  )
})

test('renders a dash for a channel without a monitor row', async () => {
  renderGroupCells([3, 8], [monitor({ channel_id: 3 })])

  await screen.findByRole('button', { name: 'Select group' })

  expect(within(screen.getByTestId('channel-8')).getByText('-')).toBeVisible()
})

test('marks the effective group as manual when a manual group is set', async () => {
  renderGroupCells(
    [3],
    [
      monitor({
        channel_id: 3,
        effective_group: 'vip',
        detected_group: 'vip',
        manual_group: 'vip',
      }),
    ]
  )

  const cell = screen.getByTestId('channel-3')
  expect(await within(cell).findByText('vip')).toBeVisible()
  expect(within(cell).getByText('Manual')).toBeVisible()
})
