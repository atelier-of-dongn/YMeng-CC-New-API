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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { DEFAULT_BAOCODE_URL } from '@/features/home/constants'
import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { SystemInfoSection } from '../system-info-section'

function Fixture(props: { baocodeLink: string }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <>
      <div ref={setContainer} />
      <SettingsPageProvider actionsContainer={container}>
        <SystemInfoSection
          defaultValues={{
            ServerAddress: '',
            Logo: '',
            Footer: '',
            About: '',
            HomePageContent: '',
            SystemName: 'New API',
            TaskPublicAddress: '',
            general_setting: { docs_link: '', baocode_link: props.baocodeLink },
            community_setting: { qq_group_link: '', telegram_link: '' },
            legal: { user_agreement: '', privacy_policy: '' },
          }}
        />
      </SettingsPageProvider>
    </>
  )
}

async function renderSettings(baocodeLink = DEFAULT_BAOCODE_URL) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(['status'], { baocode_link: baocodeLink })
  const route = createRootRoute({
    component: () => <Fixture baocodeLink={baocodeLink} />,
  })
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('textbox', { name: 'BaoCode Link' })
  return client
}

beforeEach(() => {
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
  window.localStorage.removeItem('status')
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.removeItem('status')
})

test('the approved default is an actual value and is not resaved with unrelated changes', async () => {
  const user = userEvent.setup()
  await renderSettings()
  expect(screen.getByRole('textbox', { name: 'BaoCode Link' })).toHaveValue(
    'https://baocode.dev/?ymengcc'
  )
  await user.type(
    screen.getByRole('textbox', { name: 'System Name' }),
    ' Gateway'
  )
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'SystemName',
      value: 'New API Gateway',
    })
  )
  expect(api.put).toHaveBeenCalledTimes(1)
})

test('a saved custom link is prefilled and editing saves the trimmed URL and refreshes status', async () => {
  const user = userEvent.setup()
  const client = await renderSettings(
    'https://example.com/baocode?campaign=old'
  )
  const input = screen.getByRole('textbox', { name: 'BaoCode Link' })
  expect(input).toHaveValue('https://example.com/baocode?campaign=old')
  window.localStorage.setItem('status', 'cached')
  await user.clear(input)
  await user.type(input, '  http://example.com/get?campaign=new  ')
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'general_setting.baocode_link',
      value: 'http://example.com/get?campaign=new',
    })
  )
  expect(api.put).toHaveBeenCalledTimes(1)
  await waitFor(() => {
    expect(client.getQueryState(['status'])?.isInvalidated).toBe(true)
    expect(window.localStorage.getItem('status')).toBeNull()
  })
})

test.each([
  '',
  '   ',
  '/download',
  'javascript:alert(1)',
  'ftp://example.com/get',
])(
  'rejects invalid BaoCode link %j without saving any options',
  async (invalidLink) => {
    const user = userEvent.setup()
    await renderSettings()
    const input = screen.getByRole('textbox', { name: 'BaoCode Link' })
    fireEvent.change(input, { target: { value: invalidLink } })
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(
      await screen.findByText('Enter an absolute HTTP(S) URL')
    ).toBeVisible()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(api.put).not.toHaveBeenCalled()
  }
)
