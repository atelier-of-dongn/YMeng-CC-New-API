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
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import {
  createSupportTicket,
  fetchSupportTicketAttachment,
  getSupportTicket,
  getSupportTickets,
  replySupportTicket,
} from '../api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}))

beforeEach(() => {
  vi.mocked(api.get).mockReset()
  vi.mocked(api.post).mockReset()
})

describe('support ticket API contracts', () => {
  it('creates multipart tickets with independent content, request ID, and file fields', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { success: true, message: '', data: { id: 1 } },
    })
    const file = new File(['# Details'], 'details.md')
    await createSupportTicket({ content: '', requestId: '', file })
    const form = vi.mocked(api.post).mock.calls[0][1] as FormData
    expect(vi.mocked(api.post).mock.calls[0][0]).toBe('/api/support-ticket/')
    expect(form.get('content')).toBe('')
    expect(form.get('request_id')).toBe('')
    expect(form.get('file')).toBe(file)
  })

  it('uses invoice-style page parameters and admin filters', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: {} })
    await getSupportTickets(
      'admin',
      { status: 'pending', username: 'alice', request_id: 'req-1' },
      2,
      20
    )
    expect(api.get).toHaveBeenCalledWith(
      '/api/support-ticket/admin/',
      expect.objectContaining({
        params: {
          p: 2,
          page_size: 20,
          status: 'pending',
          username: 'alice',
          request_id: 'req-1',
        },
      })
    )
  })

  it('uses scope-specific detail, reply, and attachment endpoints', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: new Blob(['# Notes'], { type: 'text/plain' }),
    })
    vi.mocked(api.post).mockResolvedValue({ data: {} })
    await getSupportTicket(8, 'self')
    await replySupportTicket(8, 'admin', 'Resolved')
    await fetchSupportTicketAttachment(8, 'self')
    expect(api.get).toHaveBeenNthCalledWith(
      1,
      '/api/support-ticket/self/8',
      expect.anything()
    )
    expect(api.post).toHaveBeenCalledWith(
      '/api/support-ticket/admin/8/replies',
      { content: 'Resolved' }
    )
    expect(api.get).toHaveBeenNthCalledWith(
      2,
      '/api/support-ticket/self/8/attachment',
      expect.objectContaining({ responseType: 'blob' })
    )
  })

  it('surfaces a JSON business failure returned by an attachment endpoint', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: new Blob([JSON.stringify({ message: 'Not available' })], {
        type: 'application/json',
      }),
    })
    await expect(fetchSupportTicketAttachment(8, 'self')).rejects.toThrow(
      'Not available'
    )
  })
})
