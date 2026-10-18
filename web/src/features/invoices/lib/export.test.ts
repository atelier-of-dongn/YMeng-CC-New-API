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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { TFunction } from 'i18next'
import * as xlsx from 'xlsx'

import type { InvoiceApplication, InvoiceListFilters } from '../types'
import {
  buildInvoiceExportData,
  buildInvoiceExportFilename,
  buildInvoiceExportWorkbook,
  collectInvoiceApplicationsForExport,
  INVOICE_EXPORT_PAGE_SIZE,
  InvoiceExportLimitError,
  MAX_XLSX_INVOICE_ROWS,
  type InvoicePageLoader,
} from './export'

const t = ((key: string) => `translated:${key}`) as TFunction

const noFilters: InvoiceListFilters = {
  status: '',
  searchField: 'username',
  keyword: '',
}

function createApplication(id: number): InvoiceApplication {
  return {
    id,
    user_id: 7,
    username: 'invoice-user',
    title: 'Example Company',
    tax_id: '0012345678',
    gross_amount: 700_000_000,
    refund_amount: 100_000_000,
    net_amount: 600_000_000,
    status: 'rejected',
    created_at: 1_700_000_000,
    updated_at: 1_700_000_100,
    issued_at: 0,
    rejected_at: 1_700_000_100,
    reject_reason: 'Incorrect tax identifier',
    items: [
      {
        id: id * 10,
        type: 'order',
        trade_no: '000001',
        amount: 300_000_000,
        occurred_at: 1_699_999_900,
      },
      {
        id: id * 10 + 1,
        type: 'order',
        trade_no: '000002',
        amount: 400_000_000,
        occurred_at: 1_699_999_950,
      },
    ],
  }
}

describe('invoice XLSX export', () => {
  test('loads every filtered page in page order', async () => {
    const filters: InvoiceListFilters = {
      status: 'rejected',
      searchField: 'trade_no',
      keyword: '000001',
    }
    const calls: Array<{
      page: number
      pageSize: number
      filters: InvoiceListFilters
    }> = []
    const applications = Array.from({ length: 205 }, (_, index) =>
      createApplication(205 - index)
    )
    const loadPage: InvoicePageLoader = async (pageFilters, page, pageSize) => {
      calls.push({ page, pageSize, filters: pageFilters })
      const start = (page - 1) * pageSize
      return {
        success: true,
        message: '',
        data: {
          items: applications.slice(start, start + pageSize),
          total: applications.length,
        },
      }
    }

    const result = await collectInvoiceApplicationsForExport(filters, loadPage)

    assert.equal(result.length, 205)
    assert.deepEqual(
      calls.map((call) => call.page),
      [1, 2, 3]
    )
    assert.ok(
      calls.every(
        (call) =>
          call.filters === filters && call.pageSize === INVOICE_EXPORT_PAGE_SIZE
      )
    )
    assert.equal(result[0]?.id, 205)
    assert.equal(result[204]?.id, 1)
  })

  test('aborts when a page fails or the worksheet row limit is exceeded', async () => {
    const failedLoader: InvoicePageLoader = async (_filters, page) => ({
      success: page === 1,
      message: 'page failed',
      data: {
        items: page === 1 ? [createApplication(1)] : [],
        total: 101,
      },
    })
    await assert.rejects(
      collectInvoiceApplicationsForExport(noFilters, failedLoader),
      /page failed/
    )

    const oversizedLoader: InvoicePageLoader = async () => ({
      success: true,
      message: '',
      data: { items: [], total: MAX_XLSX_INVOICE_ROWS + 1 },
    })
    await assert.rejects(
      collectInvoiceApplicationsForExport(noFilters, oversizedLoader),
      InvoiceExportLimitError
    )
  })

  test('keeps one row per application with typed amounts, dates, and identifiers', () => {
    const application = createApplication(12)
    const data = buildInvoiceExportData([application], t)

    assert.equal(data.length, 2)
    assert.equal(data[0]?.[0], 'translated:Application ID')
    assert.equal(data[1]?.[4], '0012345678')
    assert.equal(data[1]?.[5], '000001, 000002')
    assert.equal(data[1]?.[6], 700)
    assert.equal(data[1]?.[7], -100)
    assert.equal(data[1]?.[8], 600)
    assert.ok(data[1]?.[9] instanceof Date)
    assert.equal(data[1]?.[10], 'translated:Rejected')
    assert.equal(data[1]?.[11], 'Incorrect tax identifier')

    const workbook = buildInvoiceExportWorkbook([application], t, xlsx)
    assert.equal(workbook.SheetNames[0], 'translated Invoice applications')
    const worksheet = workbook.Sheets[workbook.SheetNames[0] || '']
    assert.ok(worksheet)
    assert.equal(worksheet.E2?.t, 's')
    assert.equal(worksheet.E2?.v, '0012345678')
    assert.equal(worksheet.G2?.t, 'n')
    assert.equal(worksheet.G2?.z, '#,##0.00####')
    assert.equal(worksheet.J2?.t, 'd')
    assert.deepEqual(worksheet['!autofilter'], { ref: 'A1:L2' })
  })

  test('uses browser-local time in the filename', () => {
    const now = new Date(2026, 7, 29, 15, 30, 45)
    assert.equal(
      buildInvoiceExportFilename(now),
      'invoice-applications-20260829-153045.xlsx'
    )
  })
})
