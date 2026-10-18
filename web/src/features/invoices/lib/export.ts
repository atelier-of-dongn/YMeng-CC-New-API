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
import type { TFunction } from 'i18next'
import type * as Xlsx from 'xlsx'

import dayjs from '@/lib/dayjs'

import { INVOICE_AMOUNT_SCALE } from '../lib'
import type {
  ApiResponse,
  InvoiceApplication,
  InvoiceListFilters,
  InvoicePage,
  InvoiceStatus,
} from '../types'

export const INVOICE_EXPORT_PAGE_SIZE = 100
export const INVOICE_EXPORT_CONCURRENCY = 4
export const MAX_XLSX_INVOICE_ROWS = 1_048_575

export class InvoiceExportEmptyError extends Error {}
export class InvoiceExportLimitError extends Error {}

export type InvoicePageLoader = (
  filters: InvoiceListFilters,
  page: number,
  pageSize: number
) => Promise<ApiResponse<InvoicePage>>

type InvoiceExportCell = Date | number | string

export async function collectInvoiceApplicationsForExport(
  filters: InvoiceListFilters,
  loadPage: InvoicePageLoader
): Promise<InvoiceApplication[]> {
  const firstPage = await loadPage(filters, 1, INVOICE_EXPORT_PAGE_SIZE)
  if (!firstPage.success) throw new Error(firstPage.message)
  if (firstPage.data.total > MAX_XLSX_INVOICE_ROWS) {
    throw new InvoiceExportLimitError()
  }

  const applications = [...(firstPage.data.items || [])]
  const totalPages = Math.ceil(firstPage.data.total / INVOICE_EXPORT_PAGE_SIZE)
  for (
    let firstPendingPage = 2;
    firstPendingPage <= totalPages;
    firstPendingPage += INVOICE_EXPORT_CONCURRENCY
  ) {
    const pageNumbers = Array.from(
      {
        length: Math.min(
          INVOICE_EXPORT_CONCURRENCY,
          totalPages - firstPendingPage + 1
        ),
      },
      (_, index) => firstPendingPage + index
    )
    const pages = await Promise.all(
      pageNumbers.map((page) =>
        loadPage(filters, page, INVOICE_EXPORT_PAGE_SIZE)
      )
    )
    for (const page of pages) {
      if (!page.success) throw new Error(page.message)
      applications.push(...(page.data.items || []))
    }
  }
  return applications
}

function getInvoiceStatusLabels(t: TFunction): Record<InvoiceStatus, string> {
  return {
    applied: t('Applied'),
    processing: t('Processing'),
    issued: t('Issued'),
    rejected: t('Rejected'),
  }
}

export function buildInvoiceExportData(
  applications: InvoiceApplication[],
  t: TFunction
): InvoiceExportCell[][] {
  const headers: string[] = [
    t('Application ID'),
    t('User'),
    t('User ID'),
    t('Invoice title'),
    t('Tax number / Unified Social Credit Code'),
    t('Orders'),
    t('Order amount'),
    t('Refund deduction'),
    t('Net invoice amount'),
    t('Applied at'),
    t('Status'),
    t('Rejection reason'),
  ]
  const statusLabels = getInvoiceStatusLabels(t)
  const rows = applications.map((application): InvoiceExportCell[] => {
    const orderNumbers: string[] = []
    for (const item of application.items) {
      if (item.type === 'order' && item.trade_no) {
        orderNumbers.push(item.trade_no)
      }
    }
    return [
      application.id,
      application.username || '',
      application.user_id,
      application.title,
      application.tax_id,
      orderNumbers.join(', '),
      application.gross_amount / INVOICE_AMOUNT_SCALE,
      -application.refund_amount / INVOICE_AMOUNT_SCALE,
      application.net_amount / INVOICE_AMOUNT_SCALE,
      new Date(application.created_at * 1000),
      statusLabels[application.status],
      application.reject_reason || '',
    ]
  })
  return [headers, ...rows]
}

function getInvoiceSheetName(t: TFunction): string {
  const name = t('Invoice applications')
    .replaceAll(/[\\/?*[\]:]/g, ' ')
    .trim()
    .slice(0, 31)
  return name || 'Invoices'
}

export function buildInvoiceExportWorkbook(
  applications: InvoiceApplication[],
  t: TFunction,
  xlsx: typeof Xlsx
): Xlsx.WorkBook {
  const data = buildInvoiceExportData(applications, t)
  const worksheet = xlsx.utils.aoa_to_sheet(data, {
    cellDates: true,
    dateNF: 'yyyy-mm-dd hh:mm:ss',
  })
  worksheet['!cols'] = [
    { wch: 14 },
    { wch: 20 },
    { wch: 12 },
    { wch: 28 },
    { wch: 24 },
    { wch: 40 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 20 },
    { wch: 14 },
    { wch: 40 },
  ]
  worksheet['!autofilter'] = { ref: `A1:L${data.length}` }
  for (let row = 2; row <= data.length; row++) {
    for (const column of ['G', 'H', 'I']) {
      const cell = worksheet[`${column}${row}`]
      if (cell) cell.z = '#,##0.00####'
    }
    const dateCell = worksheet[`J${row}`]
    if (dateCell) dateCell.z = 'yyyy-mm-dd hh:mm:ss'
  }

  const workbook = xlsx.utils.book_new()
  xlsx.utils.book_append_sheet(workbook, worksheet, getInvoiceSheetName(t))
  return workbook
}

export function buildInvoiceExportFilename(now = new Date()): string {
  return `invoice-applications-${dayjs(now).format('YYYYMMDD-HHmmss')}.xlsx`
}
