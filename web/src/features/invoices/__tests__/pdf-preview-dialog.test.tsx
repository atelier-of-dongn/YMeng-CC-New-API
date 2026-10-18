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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AxiosAdapter } from 'axios'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { InvoicePdfPreviewDialog } from '../components/invoice-pdf-preview-dialog'
import type { InvoiceApplication } from '../types'

const application: InvoiceApplication = {
  id: 7,
  user_id: 3,
  title: 'Example Company',
  tax_id: '91350000TEST',
  gross_amount: 600_000_000,
  refund_amount: 0,
  net_amount: 600_000_000,
  status: 'issued',
  created_at: 1_700_000_000,
  updated_at: 1_700_000_100,
  issued_at: 1_700_000_100,
  rejected_at: 0,
  file_name: 'invoice-7.pdf',
  file_size: 14,
  items: [],
}

const originalAdapter = api.defaults.adapter
const createObjectURL = vi.fn(() => 'blob:invoice-7')
const revokeObjectURL = vi.fn()
let adapter: ReturnType<typeof vi.fn<AxiosAdapter>>
let client: QueryClient

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL })
  )
  adapter = vi.fn<AxiosAdapter>(async (config) => ({
    data: new Blob(['%PDF-1.7\n%%EOF']),
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  }))
  api.defaults.adapter = adapter
})

afterEach(() => {
  client.clear()
  api.defaults.adapter = originalAdapter
  vi.unstubAllGlobals()
})

function renderDialog() {
  return render(
    <QueryClientProvider client={client}>
      <InvoicePdfPreviewDialog
        application={application}
        scope='admin'
        onOpenChange={() => undefined}
      />
    </QueryClientProvider>
  )
}

describe('InvoicePdfPreviewDialog', () => {
  test('loaded PDF is previewed from the admin file endpoint', async () => {
    renderDialog()

    const preview = await screen.findByLabelText('Invoice PDF preview', {
      selector: 'object',
    })
    expect(preview).toHaveAttribute('data', 'blob:invoice-7')
    expect(adapter.mock.calls[0]?.[0].url).toBe('/api/invoice/admin/7/file')
    expect(
      screen.getByRole('button', { name: 'Download PDF' })
    ).not.toBeDisabled()
  })

  test('closing the dialog revokes the preview URL', async () => {
    const view = renderDialog()
    await screen.findByLabelText('Invoice PDF preview', { selector: 'object' })

    view.unmount()

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:invoice-7')
  })

  test('server failure shows the message and retry reloads the PDF', async () => {
    adapter.mockImplementationOnce(async (config) => ({
      data: new Blob([
        JSON.stringify({ success: false, message: 'invoice not found' }),
      ]),
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }))
    renderDialog()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'invoice not found'
    )
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(adapter).toHaveBeenCalledTimes(2))
    expect(
      await screen.findByLabelText('Invoice PDF preview', {
        selector: 'object',
      })
    ).toBeInTheDocument()
  })
})
