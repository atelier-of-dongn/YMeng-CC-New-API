import { api } from '@/lib/api'
import { createServerError } from '@/lib/server-error-message'

import type {
  ApiResponse,
  CatfkOrder,
  CatfkPayRequest,
  CatfkQuote,
  CatfkQuoteRequest,
  CatfkRedemption,
} from './types'

export async function quoteCatfk(
  request: CatfkQuoteRequest
): Promise<CatfkQuote> {
  const { data } = await api.post<ApiResponse<CatfkQuote>>(
    '/api/user/catfk/quote',
    request
  )
  if (data.success !== true || !data.data) throw createServerError(data)
  return data.data
}

export class CatfkPaymentRejectedError extends Error {
  constructor(response: unknown) {
    const source = createServerError(response)
    super(source.message, { cause: source })
    this.name = 'CatfkPaymentRejectedError'
  }
}

export async function payCatfk(request: CatfkPayRequest): Promise<CatfkOrder> {
  const { data } = await api.post<
    ApiResponse<CatfkOrder> & { message_key?: string }
  >('/api/user/catfk/pay', request)
  // Only these failures guarantee that no order was submitted. Other errors may follow creation.
  const precreationRejections = [
    'Invalid CatFK payment request',
    'CatFK protocol is not verified',
    'CatFK payments are disabled',
    'CatFK order encryption key is not configured',
    'CatFK quote is invalid or expired',
    'Payment compliance confirmation is required',
  ]
  if (
    data.success === false &&
    data.message_key &&
    precreationRejections.includes(data.message_key)
  ) {
    throw new CatfkPaymentRejectedError(data)
  }
  if (data.success !== true || !data.data) throw createServerError(data)
  return data.data
}

export async function getCatfkOrder(tradeNo: string): Promise<CatfkOrder> {
  const { data } = await api.get<ApiResponse<CatfkOrder>>(
    `/api/user/catfk/orders/${encodeURIComponent(tradeNo)}`
  )
  if (data.success !== true || !data.data) throw createServerError(data)
  return data.data
}

export async function getCatfkRedemption(
  tradeNo: string
): Promise<CatfkRedemption> {
  const { data } = await api.get<ApiResponse<CatfkRedemption>>(
    `/api/user/catfk/orders/${encodeURIComponent(tradeNo)}/redemption`
  )
  if (data.success !== true || !data.data) throw createServerError(data)
  return data.data
}

export function safeCatfkQrCode(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

export function isValidCatfkQuote(
  quote: CatfkQuote | null,
  amount: number
): quote is CatfkQuote {
  return (
    !!quote &&
    typeof quote.quote_id === 'string' &&
    quote.quote_id.length > 0 &&
    Number.isFinite(quote.amount) &&
    quote.amount > 0 &&
    /^[A-Z]{3}$/.test(quote.currency) &&
    Number.isFinite(quote.topup_amount) &&
    quote.topup_amount === amount
  )
}

export function isValidCatfkQQ(value: string): boolean {
  return value.length >= 5 && value.length <= 12 && !/[^0-9]/.test(value)
}
