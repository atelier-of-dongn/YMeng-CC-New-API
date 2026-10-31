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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { TicketDetailDialog } from '../components/ticket-detail-dialog'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))

const clients: QueryClient[] = []

function renderDetail() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      message: '',
      data: {
        id: 3,
        user_id: 1,
        username: 'alice',
        status: 'replied',
        request_id: '',
        created_at: 100,
        updated_at: 200,
        last_message_at: 200,
        preview: 'Problem',
        has_attachment: false,
        messages: [
          {
            id: 1,
            author_username: 'alice',
            role: 'user',
            content: '<script>alert(1)</script>\nProblem',
            created_at: 100,
          },
          {
            id: 2,
            author_username: 'admin',
            role: 'admin',
            content: 'We are checking.',
            created_at: 200,
          },
        ],
      },
    },
  })
  render(
    <QueryClientProvider client={client}>
      <TicketDetailDialog id={3} scope='self' onOpenChange={vi.fn()} />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  for (const client of clients) client.clear()
  clients.length = 0
  vi.mocked(api.get).mockReset()
  vi.mocked(api.post).mockReset()
})

it('renders multi-turn messages as text and sends the user reply', async () => {
  vi.mocked(api.post).mockResolvedValue({
    data: { success: true, message: '', data: null },
  })
  renderDetail()
  const user = userEvent.setup()

  expect(await screen.findByText('We are checking.')).toBeVisible()
  expect(
    screen.getByText(
      (_, element) =>
        element?.tagName === 'P' &&
        element.textContent === '<script>alert(1)</script>\nProblem'
    )
  ).toBeVisible()
  expect(document.querySelector('script')).toBeNull()
  await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'More info')
  await user.click(screen.getByRole('button', { name: 'Send reply' }))

  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      '/api/support-ticket/self/3/replies',
      {
        content: 'More info',
      }
    )
  )
})

it('disables reply submission while the request is pending', async () => {
  let resolveReply: ((value: unknown) => void) | undefined
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveReply = resolve
      })
  )
  renderDetail()
  const user = userEvent.setup()

  await screen.findByText('We are checking.')
  await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'More info')
  await user.click(screen.getByRole('button', { name: 'Send reply' }))
  expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled()

  resolveReply?.({ data: { success: true, message: '', data: null } })
  expect(
    await screen.findByRole('button', { name: 'Send reply' })
  ).toBeEnabled()
})
