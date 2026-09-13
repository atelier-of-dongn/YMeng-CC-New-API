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
export type InvoiceStatus = 'applied' | 'processing' | 'issued' | 'rejected'

export type InvoiceProfile = {
  id: number
  user_id: number
  title: string
  tax_id: string
}

export type InvoiceOrder = {
  id: number
  trade_no: string
  payment_provider: string
  amount: number
  created_at: number
  completed_at: number
  invoice_status?: InvoiceStatus
}

export type InvoiceRefund = {
  id: number
  quota: number
  amount: number
  source: string
  created_at: number
}

export type InvoiceEligibility = {
  profile: InvoiceProfile | null
  orders: InvoiceOrder[]
  pending_refunds: InvoiceRefund[]
  minimum_amount: number
}

export type InvoiceItem = {
  id: number
  type: 'order' | 'refund'
  top_up_id?: number
  refund_adjustment_id?: number
  trade_no?: string
  amount: number
  occurred_at: number
}

export type InvoiceApplication = {
  id: number
  user_id: number
  username?: string
  title: string
  tax_id: string
  gross_amount: number
  refund_amount: number
  net_amount: number
  status: InvoiceStatus
  created_at: number
  updated_at: number
  issued_at: number
  rejected_at: number
  reject_reason?: string
  file_name?: string
  file_size?: number
  items: InvoiceItem[]
}

export type InvoicePage = {
  items: InvoiceApplication[]
  total: number
}

export type ApiResponse<T> = {
  success: boolean
  message: string
  data: T
}
