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
import { cleanup, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { ApiKeysEndpoint } from '../index'

let client: QueryClient

const i18n = createInstance()
await i18n.init({
  lng: 'en',
  resources: { en: { translation: {} } },
  initAsync: false,
})

beforeEach(() => {
  localStorage.clear()
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  localStorage.clear()
  vi.restoreAllMocks()
})

function renderEndpoint() {
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ApiKeysEndpoint />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

describe('ApiKeysEndpoint', () => {
  it('shows the same normalized endpoint source used by the overview request example', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          api_info_enabled: true,
          api_info: [
            {
              url: 'https://api.example.com/v1/chat/completions',
              route: 'OpenAI-compatible',
              description: '',
              color: 'blue',
            },
          ],
        },
      },
    })

    renderEndpoint()

    expect(
      await screen.findByText('https://api.example.com/v1')
    ).toBeInTheDocument()
    expect(
      screen.queryByText('https://api.example.com/v1/chat/completions')
    ).not.toBeInTheDocument()
  })

  it('falls back to the current origin when overview API info is unavailable', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          api_info_enabled: false,
          api_info: [],
        },
      },
    })

    renderEndpoint()

    expect(
      await screen.findByText(`${window.location.origin}/v1`)
    ).toBeInTheDocument()
  })
})
