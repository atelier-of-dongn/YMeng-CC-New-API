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

import type { InvoiceStatus } from './types'

export const INVOICE_AMOUNT_SCALE = 1_000_000

export function formatInvoiceAmount(value: number): string {
  return (value / INVOICE_AMOUNT_SCALE).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })
}

export function formatInvoiceTime(value: number): string {
  if (!value) return '-'
  return dayjs(value * 1000).format('YYYY-MM-DD HH:mm:ss')
}

export function getInvoiceStatusVariant(status: InvoiceStatus) {
  if (status === 'issued') return 'success' as const
  if (status === 'rejected') return 'danger' as const
  if (status === 'processing') return 'info' as const
  return 'warning' as const
}
