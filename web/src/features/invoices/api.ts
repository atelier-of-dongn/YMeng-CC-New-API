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

import { buildInvoiceListParams } from './lib/filters'
import { ensureInvoicePDFBlob, saveInvoicePDF } from './lib/pdf'
import type {
  ApiResponse,
  InvoiceApplication,
  InvoiceEligibility,
  InvoiceFileScope,
  InvoiceListFilters,
  InvoicePage,
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
  filters: InvoiceListFilters,
  page = 1,
  pageSize = 50,
  signal?: AbortSignal
) {
  const response = await api.get<ApiResponse<InvoicePage>>(
    '/api/invoice/admin/',
    {
      params: {
        ...buildInvoiceListParams(filters),
        p: page,
        page_size: pageSize,
      },
      signal,
    }
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

export async function fetchInvoicePDF(
  id: number,
  scope: InvoiceFileScope,
  signal?: AbortSignal
): Promise<Blob> {
  // Native links and frames cannot carry the dashboard Bearer token, so the
  // PDF is always fetched through the shared client and shown as a Blob.
  const response = await api.get<Blob>(`/api/invoice/${scope}/${id}/file`, {
    responseType: 'blob',
    signal,
    disableDuplicate: true,
    skipBusinessError: true,
    skipErrorHandler: true,
  })
  return ensureInvoicePDFBlob(response.data)
}

export function getInvoicePDFFileName(application: {
  id: number
  file_name?: string
}) {
  return application.file_name || `invoice-${application.id}.pdf`
}

export async function downloadInvoicePDF(
  application: { id: number; file_name?: string },
  scope: InvoiceFileScope
) {
  const blob = await fetchInvoicePDF(application.id, scope)
  saveInvoicePDF(blob, getInvoicePDFFileName(application))
}
