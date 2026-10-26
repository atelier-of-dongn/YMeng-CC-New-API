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
import { UserInvoiceForm } from '../components/user-invoice-form'
import type { InvoiceApplication, InvoiceEligibility } from '../types'
import { UserInvoicePage } from '../user-page'

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

test('hides issued orders and keeps the application form and selection when switching lists', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/invoice/eligibility') {
      return {
        data: {
          success: true,
          data: {
            profile: null,
            minimum_amount: 500,
            orders: [
              {
                id: 1,
                trade_no: 'AVAILABLE-ORDER',
                payment_provider: 'card',
                amount: 1000,
                created_at: 1,
                completed_at: 2,
              },
              {
                id: 2,
                trade_no: 'ISSUED-ORDER',
                payment_provider: 'card',
                amount: 1200,
                created_at: 1,
                completed_at: 2,
                invoice_status: 'issued',
              },
              {
                id: 3,
                trade_no: 'PROCESSING-ORDER',
                payment_provider: 'card',
                amount: 1500,
                created_at: 1,
                completed_at: 2,
                invoice_status: 'processing',
              },
            ],
            pending_refunds: [],
          },
        },
      }
    }

    return { data: { success: true, data: { items: [], total: 0 } } }
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  const user = userEvent.setup()
  const { container } = render(
    <QueryClientProvider client={client}>
      <UserInvoicePage />
    </QueryClientProvider>
  )

  const orderCheckbox = await screen.findByRole('checkbox', {
    name: 'Select order AVAILABLE-ORDER',
  })
  expect(screen.queryByText('ISSUED-ORDER')).not.toBeInTheDocument()
  expect(
    screen.getByRole('checkbox', { name: 'Select order PROCESSING-ORDER' })
  ).toHaveAttribute('aria-disabled', 'true')
  await user.click(orderCheckbox)
  await user.type(screen.getByLabelText('Invoice title'), 'Example Company')

  await user.click(screen.getByRole('button', { name: 'Invoice records' }))
  expect(screen.getByText('No invoice applications')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Invoice records' })
  ).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: 'Invoice orders' }))
  expect(
    screen.getByRole('button', { name: 'Invoice orders' })
  ).toHaveAttribute('aria-pressed', 'true')

  expect(screen.getByLabelText('Invoice title')).toHaveValue('Example Company')
  expect(
    screen.getByRole('checkbox', { name: 'Select order AVAILABLE-ORDER' })
  ).toBeChecked()
  expect(container.querySelectorAll('.overflow-y-auto')).toHaveLength(2)
  await waitFor(() => expect(screen.getByRole('table')).toBeVisible())
  const formRegion = screen.getByRole('region', {
    name: 'New invoice application',
  })
  const listRegion = screen.getByRole('region', { name: 'Invoice orders' })
  expect(formRegion).toHaveClass('min-h-0', 'overflow-y-auto')
  expect(listRegion).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto')
  expect(formRegion).not.toContainElement(screen.getByRole('table'))
  expect(listRegion).toContainElement(screen.getByRole('table'))
  expect(listRegion).not.toContainElement(
    screen.getByRole('button', { name: 'Invoice records' })
  )
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

test('submits only currently eligible selected orders and deducts mandatory refunds', async () => {
  const eligibility: InvoiceEligibility = {
    profile: null,
    minimum_amount: 500,
    orders: [
      {
        id: 1,
        trade_no: 'AVAILABLE',
        payment_provider: 'card',
        amount: 1000,
        created_at: 1,
        completed_at: 2,
      },
      {
        id: 2,
        trade_no: 'ISSUED',
        payment_provider: 'card',
        amount: 2000,
        created_at: 1,
        completed_at: 2,
        invoice_status: 'issued',
      },
    ],
    pending_refunds: [
      { id: 1, quota: 0, amount: 100, source: 'refund', created_at: 2 },
    ],
  }
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: {} } })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  const onSubmitted = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <UserInvoiceForm
        eligibility={eligibility}
        selectedIds={new Set([1, 2, 999])}
        onSubmitted={onSubmitted}
      />
    </QueryClientProvider>
  )
  expect(
    screen.getByText('Net invoice amount').nextElementSibling
  ).toHaveTextContent('0.0009')
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Invoice title'), 'Example Company')
  await user.type(
    screen.getByLabelText('Tax number / Unified Social Credit Code'),
    '91310000MA12345678'
  )
  await user.click(
    screen.getByRole('button', { name: 'Submit invoice application' })
  )
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/invoice/', {
      title: 'Example Company',
      tax_id: '91310000MA12345678',
      top_up_ids: [1],
    })
  )
  await waitFor(() => expect(onSubmitted).toHaveBeenCalled())
})
