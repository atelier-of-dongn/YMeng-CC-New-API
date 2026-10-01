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
import { describe, expect, test } from 'vitest'

import dayjs from '@/lib/dayjs'

import { buildInvoiceListParams, getInvoiceSearchError } from '../lib/filters'

describe('invoice list search parameters', () => {
  test('text column search sends only the selected column and status', () => {
    expect(
      buildInvoiceListParams({
        status: 'issued',
        searchField: 'tax_id',
        keyword: '  9135 ',
      })
    ).toEqual({ status: 'issued', tax_id: '9135' })
  })

  test('amount column search becomes an exact inclusive range', () => {
    expect(
      buildInvoiceListParams({
        status: '',
        searchField: 'refund_amount',
        keyword: '-1,000.5',
      })
    ).toEqual({ refund_amount_min: '1000.5', refund_amount_max: '1000.5' })
  })

  test('applied date search covers the whole local day', () => {
    const params = buildInvoiceListParams({
      status: '',
      searchField: 'created_at',
      keyword: '2026-03-08',
    })

    expect(params.created_at_from).toBe(
      String(dayjs('2026-03-08').startOf('day').unix())
    )
    expect(params.created_at_to).toBe(
      String(dayjs('2026-03-09').startOf('day').unix())
    )
  })

  test('invalid keyword for the selected column is not sent', () => {
    expect(getInvoiceSearchError('net_amount', '1.1234567')).toBe(
      'Enter an amount with up to 6 decimal places'
    )
    expect(
      buildInvoiceListParams({
        status: '',
        searchField: 'user_id',
        keyword: 'abc',
      })
    ).toEqual({})
  })
})
