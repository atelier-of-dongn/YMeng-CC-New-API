import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { isValidCatfkQQ, safeCatfkQrCode } from '../catfk-api'
import { useCatfkPayment } from '../hooks/use-catfk-payment'

const channel = { id: 'wechat', name: 'WeChat' }
const product = { id: 'ten', name: 'Ten dollars', amount: 10 }
const info = {
  enabled: true,
  available: true,
  products: [product],
  channels: [channel],
}
const quote = { quote_id: 'q1', amount: 72, currency: 'CNY', topup_amount: 10 }
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
beforeEach(() => {
  localStorage.clear()
  vi.spyOn(window, 'open').mockReturnValue(null)
})

function pendingOrder(trade: string) {
  return {
    data: {
      success: true,
      data: {
        trade_no: trade,
        status: 'pending',
        payment_qr_code: 'https://qr.alipay.com/upx-code',
      },
    },
  }
}

function orderRead(trade: string, status: string) {
  return {
    data: {
      success: true,
      data: { trade_no: trade, status },
    },
  }
}

async function payOnce(
  result: { current: ReturnType<typeof useCatfkPayment> },
  qq = '12345'
) {
  await act(() => result.current.selectProduct(product, channel))
  act(() => result.current.setQQ(qq))
  await act(() => result.current.confirm())
}

afterEach(() => vi.restoreAllMocks())

it('shows the QR code dialog without opening a window and refreshes the wallet once after completed settlement', async () => {
  vi.spyOn(api, 'post')
    .mockResolvedValueOnce({ data: { success: true, data: quote } })
    .mockResolvedValueOnce(pendingOrder('trade1'))
  const read = vi
    .spyOn(api, 'get')
    .mockResolvedValue(orderRead('trade1', 'pending'))
  const completed = vi.fn().mockResolvedValue(undefined)
  const { result } = renderHook(() => useCatfkPayment(info, 1, completed), {
    wrapper,
  })
  await payOnce(result)
  expect(window.open).not.toHaveBeenCalled()
  expect(result.current.open).toBe(false)
  expect(result.current.statusOrder).toEqual({
    tradeNo: 'trade1',
    amount: 10,
    status: 'pending',
    paymentQrCode: 'https://qr.alipay.com/upx-code',
  })
  read.mockResolvedValue(orderRead('trade1', 'completed'))
  act(() => window.dispatchEvent(new Event('focus')))
  await waitFor(() =>
    expect(result.current.statusOrder?.status).toBe('completed')
  )
  expect(result.current.statusOrder?.paymentQrCode).toBeNull()
  await waitFor(() => expect(completed).toHaveBeenCalledOnce())
  const reads = read.mock.calls.length
  act(() => window.dispatchEvent(new Event('focus')))
  expect(read).toHaveBeenCalledTimes(reads)
  expect(localStorage.length).toBe(0)
})

it('ends the order for the user when the dialog closes and creates a new order for the next purchase', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValueOnce({ data: { success: true, data: quote } })
    .mockResolvedValueOnce(pendingOrder('first'))
    .mockResolvedValueOnce({ data: { success: true, data: quote } })
    .mockResolvedValueOnce(pendingOrder('second'))
  const read = vi
    .spyOn(api, 'get')
    .mockResolvedValue(orderRead('first', 'pending'))
  const { result } = renderHook(() => useCatfkPayment(info, 1), { wrapper })
  await payOnce(result)
  act(() => result.current.closeStatus())
  expect(result.current.statusOrder).toBeNull()
  const reads = read.mock.calls.length
  act(() => window.dispatchEvent(new Event('focus')))
  expect(read).toHaveBeenCalledTimes(reads)
  await payOnce(result)
  expect(result.current.statusOrder?.tradeNo).toBe('second')
  const firstKey = (post.mock.calls[1][1] as { idempotency_key: string })
    .idempotency_key
  const secondKey = (post.mock.calls[3][1] as { idempotency_key: string })
    .idempotency_key
  expect(secondKey).not.toBe(firstKey)
  expect(localStorage.length).toBe(0)
})

it('reuses the request key when confirming again after a lost response and never blocks a new purchase', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValueOnce({ data: { success: true, data: quote } })
    .mockRejectedValueOnce(new Error('Network disconnected'))
    .mockResolvedValueOnce(pendingOrder('recovered'))
  vi.spyOn(api, 'get').mockResolvedValue(orderRead('recovered', 'pending'))
  const { result } = renderHook(() => useCatfkPayment(info, 1), { wrapper })
  await payOnce(result, '001234')
  expect(result.current.statusOrder).toBeNull()
  expect(result.current.open).toBe(true)
  expect(result.current.qq).toBe('001234')
  await act(() => result.current.confirm())
  expect(post.mock.calls[2][1]).toEqual(post.mock.calls[1][1])
  expect(result.current.statusOrder?.tradeNo).toBe('recovered')
})

it('accepts only ASCII digit QQ strings and bounded HTTPS QR codes without credentials', () => {
  for (const value of ['12345', '0012345', '123456789012']) {
    expect(isValidCatfkQQ(value)).toBe(true)
  }
  for (const value of [
    '',
    '1234',
    '1234567890123',
    '１２３４５',
    '12 345',
    '+12345',
    '12345\n',
  ]) {
    expect(isValidCatfkQQ(value)).toBe(false)
  }
  expect(safeCatfkQrCode('https://qr.alipay.com/upx-code')).toBe(
    'https://qr.alipay.com/upx-code'
  )
  for (const value of [
    'http://pay.example',
    'javascript:alert(1)',
    'https://user:pass@pay.example',
    `https://qr.alipay.com/${'a'.repeat(2048)}`,
  ]) {
    expect(safeCatfkQrCode(value)).toBeNull()
  }
})
it('ignores an old quote after switching channels', async () => {
  let resolve!: (value: unknown) => void
  vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  const { result } = renderHook(() => useCatfkPayment(info, 1), { wrapper })
  act(() => result.current.selectChannel(channel))
  let request!: Promise<void>
  act(() => {
    request = result.current.selectProduct(product)
  })
  await waitFor(() => expect(resolve).toBeDefined())
  act(() => result.current.selectChannel(null))
  await act(async () => {
    resolve({ data: { success: true, data: quote } })
    await request
  })
  expect(result.current.quote).toBeNull()
  expect(result.current.open).toBe(false)
})
it('clears the previous account quote, QQ and channel when the account changes', async () => {
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: quote },
  })
  const { result, rerender } = renderHook(
    ({ id }) => useCatfkPayment(info, id),
    { wrapper, initialProps: { id: 1 } }
  )
  act(() => result.current.selectChannel(channel))
  await act(() => result.current.selectProduct(product))
  act(() => result.current.setQQ('001234'))
  rerender({ id: 2 })
  expect(result.current.statusOrder).toBeNull()
  expect(result.current.qq).toBe('')
  expect(result.current.quote).toBeNull()
  expect(result.current.channel).toBeNull()
  expect(result.current.open).toBe(false)
})
