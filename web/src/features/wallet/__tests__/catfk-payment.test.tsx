import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { isValidCatfkQQ, safeCatfkPaymentUrl } from '../catfk-api'
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
})

it('accepts only ASCII digit QQ strings and HTTPS payment URLs without credentials', () => {
  expect(isValidCatfkQQ('0012345')).toBe(true)
  for (const value of ['', '１２３', '12 34', '+123', '123\n']) {
    expect(isValidCatfkQQ(value)).toBe(false)
  }
  expect(safeCatfkPaymentUrl('https://pay.example/order')).toBe(
    'https://pay.example/order'
  )
  for (const value of [
    'http://pay.example',
    'javascript:alert(1)',
    'https://user:pass@pay.example',
  ]) {
    expect(safeCatfkPaymentUrl(value)).toBeNull()
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
it('preserves QQ and the idempotency key after an unknown creation result', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValueOnce({ data: { success: true, data: quote } })
    .mockRejectedValue(new Error('Network disconnected'))
  const { result } = renderHook(() => useCatfkPayment(info, 1), { wrapper })
  act(() => result.current.selectChannel(channel))
  await act(() => result.current.selectProduct(product))
  act(() => result.current.setQQ('001234'))
  await act(() => result.current.confirm())
  expect(result.current.qq).toBe('001234')
  expect(result.current.uncertain).toBe(true)
  expect(localStorage.getItem('wallet:catfk:order:1')).toBe('creation_unknown')
  const first = post.mock.calls[1][1]
  await act(() => result.current.confirm())
  expect(post.mock.calls[2][1]).toEqual(first)
  act(() => result.current.setQQ('999'))
  await act(() => result.current.confirm())
  expect(post).toHaveBeenCalledTimes(3)
  act(() => result.current.reset())
  expect(result.current.qq).toBe('')
  await act(() => result.current.selectProduct(product))
  expect(result.current.open).toBe(false)
})
it('allows correcting QQ after a definite server rejection without keeping the unknown guard', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValueOnce({ data: { success: true, data: quote } })
    .mockResolvedValueOnce({
      data: {
        success: false,
        message: '请求无效',
        message_key: 'Invalid CatFK payment request',
      },
    })
    .mockResolvedValueOnce({
      data: { success: true, data: { trade_no: 'order1', status: 'paid' } },
    })
  const { result } = renderHook(() => useCatfkPayment(info, 1), { wrapper })
  act(() => result.current.selectChannel(channel))
  await act(() => result.current.selectProduct(product))
  act(() => result.current.setQQ('1234'))
  await act(() => result.current.confirm())
  expect(result.current.qq).toBe('1234')
  expect(result.current.uncertain).toBe(false)
  expect(localStorage.getItem('wallet:catfk:order:1')).toBeNull()
  act(() => result.current.setQQ('5678'))
  await act(() => result.current.confirm())
  expect(post.mock.calls[2][1]).toMatchObject({
    qq: '5678',
    product_id: 'ten',
    channel_id: 'wechat',
    quote_id: 'q1',
  })
  expect(post.mock.calls[2][1]).not.toHaveProperty('amount')
  expect(post.mock.calls[2][1]).not.toHaveProperty('quantity')
  expect(result.current.orderStatus).toBe('paid')
})
it.each([
  { message_key: 'CatFK order is unavailable', message: 'Order unavailable' },
  { message: 'Invalid CatFK payment request' },
])(
  'keeps unknown creation protection for non-precreation failures: %j',
  async (response) => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValueOnce({ data: { success: true, data: quote } })
      .mockResolvedValueOnce({ data: { success: false, ...response } })
    const { result } = renderHook(() => useCatfkPayment(info, 1), { wrapper })
    act(() => result.current.selectChannel(channel))
    await act(() => result.current.selectProduct(product))
    act(() => result.current.setQQ('1234'))
    await act(() => result.current.confirm())
    expect(result.current.qq).toBe('1234')
    expect(result.current.uncertain).toBe(true)
    expect(localStorage.getItem('wallet:catfk:order:1')).toBe(
      'creation_unknown'
    )
    act(() => result.current.setQQ('5678'))
    await act(() => result.current.confirm())
    expect(post).toHaveBeenCalledTimes(2)
  }
)
it('allows choosing another product while a known pending order remains recoverable', async () => {
  localStorage.setItem('wallet:catfk:order:1', 'old-order')
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: quote },
  })
  const { result } = renderHook(() => useCatfkPayment(info, 1), { wrapper })
  act(() => result.current.selectChannel(channel))
  await act(() => result.current.selectProduct(product))
  expect(result.current.open).toBe(true)
  expect(result.current.blocked).toBe(false)
  expect(result.current.pendingTrade).toBe('old-order')
})
it.each(['paid', 'needs_attention', 'creation_unknown'])(
  'keeps %s orders for follow-up without claiming credit',
  async (status) => {
    localStorage.setItem('wallet:catfk:order:1', 'trade1')
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: { trade_no: 'trade1', status } },
    })
    const completed = vi.fn()
    const { result } = renderHook(() => useCatfkPayment(info, 1, completed), {
      wrapper,
    })
    await act(() => result.current.resume())
    expect(result.current.orderStatus).toBe(status)
    expect(result.current.pendingTrade).toBe('trade1')
    expect(localStorage.getItem('wallet:catfk:order:1')).toBe('trade1')
    expect(completed).not.toHaveBeenCalled()
  }
)
it('refreshes wallet data only when the recovered order is completed', async () => {
  localStorage.setItem('wallet:catfk:order:1', 'trade1')
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { trade_no: 'trade1', status: 'completed' } },
  })
  const completed = vi.fn().mockResolvedValue(undefined)
  const { result } = renderHook(() => useCatfkPayment(info, 1, completed), {
    wrapper,
  })
  await act(() => result.current.resume())
  expect(completed).toHaveBeenCalledOnce()
  expect(result.current.orderStatus).toBe('completed')
  expect(localStorage.getItem('wallet:catfk:order:1')).toBeNull()
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
  expect(result.current.qq).toBe('')
  expect(result.current.quote).toBeNull()
  expect(result.current.channel).toBeNull()
  expect(result.current.open).toBe(false)
})
