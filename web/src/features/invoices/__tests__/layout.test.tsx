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
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import { DataTableView } from '@/components/data-table'
import { TooltipProvider } from '@/components/ui/tooltip'

import { useAdminInvoiceColumns } from '../components/admin-invoice-columns'
import type { InvoiceApplication } from '../types'

const application: InvoiceApplication = {
  id: 1,
  user_id: 42,
  username: 'invoice-user-with-a-long-unbroken-name',
  title: 'CompanyWithAnExtremelyLongUnbrokenInvoiceTitle',
  tax_id: 'TAXIDENTIFIER123456789012345678901234567890',
  gross_amount: 100,
  refund_amount: 0,
  net_amount: 100,
  status: 'applied',
  created_at: 1700000000,
  updated_at: 1700000000,
  issued_at: 0,
  rejected_at: 0,
  items: [
    {
      id: 1,
      type: 'order',
      trade_no: 'ORDER123456789012345678901234567890',
      amount: 100,
      occurred_at: 1700000000,
    },
  ],
}

const handlers = {
  onStartProcessing: vi.fn(),
  onUpload: vi.fn(),
  onReject: vi.fn(),
  onPreview: vi.fn(),
  onDownload: vi.fn(),
}

function Fixture(props: { application?: InvoiceApplication }) {
  const columns = useAdminInvoiceColumns(handlers)
  const table = useReactTable({
    data: [props.application ?? application],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })
  return (
    <TooltipProvider>
      <DataTableView table={table} splitHeader />
    </TooltipProvider>
  )
}

describe('invoice management text layout', () => {
  test.each([
    ['username', 'sm:max-w-[140px]', 1],
    ['title', 'sm:max-w-[220px]', 2],
    ['tax_id', 'sm:max-w-[220px]', 3],
  ] as const)(
    'long %s is bounded on desktop and can reveal its full text by keyboard',
    async (field, desktopWidth, tabCount) => {
      const user = userEvent.setup()
      render(<Fixture />)
      const text = application[field] ?? ''
      const trigger = screen.getByText(text).closest('[tabindex="0"]')

      expect(trigger).toHaveClass('max-w-full', 'truncate', desktopWidth)
      for (let index = 0; index <= tabCount; index++) {
        await user.tab()
      }
      expect(trigger).toHaveFocus()
      await waitFor(() => {
        const popup = document.querySelector('[data-slot="tooltip-content"]')
        expect(popup).toBeVisible()
        expect(popup).toHaveTextContent(text)
      })
      await user.keyboard('{Escape}')
      await waitFor(() =>
        expect(
          document.querySelector('[data-slot="tooltip-content"]')
        ).not.toBeInTheDocument()
      )
    }
  )

  test('a long unbroken rejection reason wraps within its bounded status cell', () => {
    const reason = 'InvalidTaxIdentifier'.repeat(25)
    render(
      <Fixture
        application={{ ...application, status: 'rejected', reject_reason: reason }}
      />
    )

    const paragraph = screen.getByText(reason, { exact: false })
    expect(paragraph).toHaveClass('wrap-anywhere', 'whitespace-pre-wrap')
    expect(paragraph).toHaveTextContent(reason)
  })

  test('an empty username keeps the fallback and user ID visible', () => {
    render(<Fixture application={{ ...application, username: '' }} />)

    expect(screen.getByText('-')).toBeVisible()
    expect(screen.getByText('ID: 42')).toBeVisible()
  })

  test('a long order number stays bounded and retains its complete value', () => {
    render(<Fixture />)

    const order = screen.getByText(application.items[0].trade_no ?? '')
    expect(order).toHaveClass('max-w-64', 'truncate')
    expect(order).toHaveAttribute('title', application.items[0].trade_no)
  })
})
