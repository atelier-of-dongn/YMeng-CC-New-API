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
  InvoiceApplication,
  InvoiceEligibility,
  InvoicePage,
  InvoiceStatus,
} from './types'

export async function getInvoiceEligibility() {
  const response = await api.get<ApiResponse<InvoiceEligibility>>(
    '/api/invoice/eligibility'
  )
  return response.data
}

export async function getUserInvoices(page = 1, pageSize = 50) {
  const response = await api.get<ApiResponse<InvoicePage>>(
    '/api/invoice/self',
    { params: { p: page, page_size: pageSize } }
  )
  return response.data
}

export async function createInvoice(payload: {
  title: string
  tax_id: string
  top_up_ids: number[]
}) {
  const response = await api.post<ApiResponse<InvoiceApplication>>(
    '/api/invoice/',
    payload
  )
  return response.data
}

export async function getAdminInvoices(
  status: InvoiceStatus | '',
  page = 1,
  pageSize = 50
) {
  const response = await api.get<ApiResponse<InvoicePage>>(
    '/api/invoice/admin/',
    { params: { status, p: page, page_size: pageSize } }
  )
  return response.data
}

export async function markInvoiceProcessing(id: number) {
  const response = await api.patch<ApiResponse<null>>(
    `/api/invoice/admin/${id}/processing`
  )
  return response.data
}

export async function rejectInvoice(id: number, reason: string) {
  const response = await api.patch<ApiResponse<null>>(
    `/api/invoice/admin/${id}/reject`,
    { reason },
    { skipBusinessError: true, skipErrorHandler: true }
  )
  return response.data
}

export async function uploadInvoicePDF(id: number, file: File) {
  const form = new FormData()
  form.append('file', file)
  const response = await api.post<ApiResponse<null>>(
    `/api/invoice/admin/${id}/file`,
    form
  )
  return response.data
}

export async function downloadInvoicePDF(id: number, fileName?: string) {
  const response = await api.get(`/api/invoice/self/${id}/file`, {
    responseType: 'blob',
    skipBusinessError: true,
  })
  const url = URL.createObjectURL(response.data as Blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName || `invoice-${id}.pdf`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
