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
import { api } from '@/lib/api'

import type {
  ApiResponse,
  SupportTicket,
  SupportTicketListFilters,
  SupportTicketPage,
  SupportTicketScope,
} from './types'

function getTicketPath(scope: SupportTicketScope): string {
  return `/api/support-ticket/${scope}`
}

export async function getSupportTickets(
  scope: SupportTicketScope,
  filters: SupportTicketListFilters,
  page = 1,
  pageSize = 20,
  signal?: AbortSignal
): Promise<ApiResponse<SupportTicketPage>> {
  const response = await api.get<ApiResponse<SupportTicketPage>>(
    `${getTicketPath(scope)}${scope === 'admin' ? '/' : ''}`,
    {
      params: {
        p: page,
        page_size: pageSize,
        status: filters.status || undefined,
        username: filters.username || undefined,
        request_id: filters.request_id || undefined,
      },
      signal,
    }
  )
  return response.data
}

export async function getSupportTicket(
  id: number,
  scope: SupportTicketScope,
  signal?: AbortSignal
): Promise<ApiResponse<SupportTicket>> {
  const response = await api.get<ApiResponse<SupportTicket>>(
    `${getTicketPath(scope)}/${id}`,
    { signal }
  )
  return response.data
}

export async function createSupportTicket(input: {
  content: string
  requestId: string
  file: File | null
}): Promise<ApiResponse<SupportTicket>> {
  const form = new FormData()
  form.append('content', input.content.trim())
  form.append('request_id', input.requestId.trim())
  if (input.file) form.append('file', input.file)
  const response = await api.post<ApiResponse<SupportTicket>>(
    '/api/support-ticket/',
    form
  )
  return response.data
}

export async function replySupportTicket(
  id: number,
  scope: SupportTicketScope,
  content: string
): Promise<ApiResponse<null>> {
  const response = await api.post<ApiResponse<null>>(
    `${getTicketPath(scope)}/${id}/replies`,
    { content: content.trim() }
  )
  return response.data
}

export async function fetchSupportTicketAttachment(
  id: number,
  scope: SupportTicketScope,
  signal?: AbortSignal
): Promise<Blob> {
  const response = await api.get<Blob>(
    `${getTicketPath(scope)}/${id}/attachment`,
    {
      responseType: 'blob',
      signal,
      disableDuplicate: true,
      skipBusinessError: true,
      skipErrorHandler: true,
    }
  )
  if (response.data.type.includes('json')) {
    const payload = JSON.parse(await response.data.text()) as {
      message?: unknown
    }
    throw new Error(
      typeof payload.message === 'string'
        ? payload.message
        : 'Attachment is unavailable.'
    )
  }
  return response.data
}

export function downloadSupportTicketAttachment(
  blob: Blob,
  name: string
): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
