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
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { InvoiceHistory } from '../components/invoice-history'
import { InvoiceOrdersTable } from '../components/invoice-orders-table'
import type { InvoiceApplication, InvoiceEligibility } from '../types'

const clients: QueryClient[] = []

const invoiceApplication: InvoiceApplication = {
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

function renderHistory(applications: InvoiceApplication[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <InvoiceHistory applications={applications} />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  for (const client of clients) client.clear()
  clients.length = 0
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('opens and closes a self invoice PDF preview from an issued record', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: new Blob(['%PDF-1.7\n%%EOF']),
  })
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn(() => 'blob:invoice-7'),
      revokeObjectURL: vi.fn(),
    })
  )
  renderHistory([invoiceApplication])
  const user = userEvent.setup()

  await user.click(screen.getByRole('button', { name: 'Preview PDF' }))

  const preview = await screen.findByLabelText('Invoice PDF preview', {
    selector: 'object',
  })
  expect(preview).toHaveAttribute('data', 'blob:invoice-7')
  expect(get).toHaveBeenCalledWith(
    '/api/invoice/self/7/file',
    expect.objectContaining({ responseType: 'blob' })
  )

  const closeButtons = screen.getAllByRole('button', { name: 'Close' })
  await user.click(closeButtons[0] as HTMLElement)
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})

test('shows preview and download only for issued applications with files', () => {
  const withoutFile = { ...invoiceApplication, id: 8, file_name: undefined }
  const processing = {
    ...invoiceApplication,
    id: 9,
    status: 'processing' as const,
  }
  renderHistory([invoiceApplication, withoutFile, processing])

  const issuedRow = screen.getByText('#7').closest('tr') as HTMLElement
  const withoutFileRow = screen.getByText('#8').closest('tr') as HTMLElement
  const processingRow = screen.getByText('#9').closest('tr') as HTMLElement
  expect(issuedRow).not.toBeNull()
  expect(withoutFileRow).not.toBeNull()
  expect(processingRow).not.toBeNull()
  expect(
    within(issuedRow).getByRole('button', { name: 'Preview PDF' })
  ).toBeVisible()
  expect(
    within(issuedRow).getByRole('button', { name: 'Download' })
  ).toBeVisible()
  for (const row of [withoutFileRow, processingRow]) {
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
  }
})

test('shows the empty state when every order has an issued invoice', () => {
  const eligibility: InvoiceEligibility = {
    profile: null,
    minimum_amount: 500,
    orders: [
      {
        id: 1,
        trade_no: 'ISSUED-ONLY',
        payment_provider: 'card',
        amount: 1000,
        created_at: 1,
        completed_at: 2,
        invoice_status: 'issued',
      },
    ],
    pending_refunds: [],
  }
  render(
    <InvoiceOrdersTable
      eligibility={eligibility}
      selectedIds={new Set()}
      onToggleOrder={vi.fn()}
    />
  )
  expect(screen.getByText('No invoiceable recharge orders')).toBeVisible()
  expect(screen.queryByText('ISSUED-ONLY')).not.toBeInTheDocument()
})
