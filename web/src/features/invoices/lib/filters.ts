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
import dayjs from '@/lib/dayjs'

import type { InvoiceListFilters, InvoiceSearchField } from '../types'

export const INVOICE_SEARCH_FIELDS = [
  'username',
  'user_id',
  'title',
  'tax_id',
  'trade_no',
  'gross_amount',
  'refund_amount',
  'net_amount',
  'created_at',
] as const satisfies readonly InvoiceSearchField[]

export const DEFAULT_INVOICE_SEARCH_FIELD: InvoiceSearchField = 'username'

// Labels are i18n keys; render them with t().
export const INVOICE_SEARCH_FIELD_LABELS: Record<InvoiceSearchField, string> = {
  username: 'Username',
  user_id: 'User ID',
  title: 'Invoice title',
  tax_id: 'Tax number / Unified Social Credit Code',
  trade_no: 'Order number',
  gross_amount: 'Order amount',
  refund_amount: 'Refund deduction',
  net_amount: 'Net invoice amount',
  created_at: 'Applied at',
}

const AMOUNT_PATTERN = /^\d+(\.\d{1,6})?$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isInvoiceAmountSearchField(field: InvoiceSearchField) {
  return (
    field === 'gross_amount' ||
    field === 'refund_amount' ||
    field === 'net_amount'
  )
}

function normalizeInvoiceAmount(field: InvoiceSearchField, keyword: string) {
  const value = keyword.replaceAll(',', '')
  // Refund deductions are displayed with a leading minus sign.
  return field === 'refund_amount' ? value.replace(/^-/, '') : value
}

/**
 * Returns the i18n key describing why a keyword cannot be searched in the
 * field, or null when the keyword is empty or valid.
 */
export function getInvoiceSearchError(
  field: InvoiceSearchField,
  keyword: string
): string | null {
  const value = keyword.trim()
  if (value === '') return null
  if (field === 'user_id') {
    return /^[1-9]\d{0,9}$/.test(value) ? null : 'Enter a valid user ID'
  }
  if (isInvoiceAmountSearchField(field)) {
    return AMOUNT_PATTERN.test(normalizeInvoiceAmount(field, value))
      ? null
      : 'Enter an amount with up to 6 decimal places'
  }
  if (field === 'created_at') {
    return DATE_PATTERN.test(value) && dayjs(value).isValid()
      ? null
      : 'Enter a valid date'
  }
  return value.length > 255 ? 'Keyword must be 255 characters or fewer' : null
}

/**
 * Converts the admin list filters into API query parameters. A keyword that
 * is invalid for its field is ignored instead of being sent to the server.
 */
export function buildInvoiceListParams(
  filters: InvoiceListFilters
): Record<string, string> {
  const params: Record<string, string> = {}
  if (filters.status) params.status = filters.status

  const keyword = filters.keyword.trim()
  if (!keyword || getInvoiceSearchError(filters.searchField, keyword)) {
    return params
  }
  if (isInvoiceAmountSearchField(filters.searchField)) {
    const amount = normalizeInvoiceAmount(filters.searchField, keyword)
    params[`${filters.searchField}_min`] = amount
    params[`${filters.searchField}_max`] = amount
    return params
  }
  if (filters.searchField === 'created_at') {
    const day = dayjs(keyword).startOf('day')
    params.created_at_from = String(day.unix())
    params.created_at_to = String(day.add(1, 'day').unix())
    return params
  }
  params[filters.searchField] = keyword
  return params
}
