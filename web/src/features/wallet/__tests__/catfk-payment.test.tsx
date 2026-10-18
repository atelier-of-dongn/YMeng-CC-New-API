import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'

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
  vi.spyOn(window, 'open').mockReturnValue(null)
})

afterEach(() => vi.restoreAllMocks())

it('keeps the site open and closes the payment window only after server-confirmed payment', async () => {
  const popup = {
    opener: {},
    location: { href: '' },
    close: vi.fn(),
    closed: false,
  }
  const open = vi
    .spyOn(window, 'open')
    .mockReturnValue(popup as unknown as Window)
  vi.spyOn(api, 'post')
    .mockResolvedValueOnce({ data: { success: true, data: quote } })
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          trade_no: 'trade1',
          status: 'pending',
          payment_url: 'https://pay.example/checkout',
        },
      },
    })
  const read = vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { trade_no: 'trade1', status: 'pending' } },
  })
  const completed = vi.fn()
  const { result } = renderHook(() => useCatfkPayment(info, 1, completed), {
    wrapper,
  })
  act(() => result.current.selectChannel(channel))
  await act(() => result.current.selectProduct(product))
  act(() => result.current.setQQ('12345'))
  await act(() => result.current.confirm())
  expect(open).toHaveBeenCalledWith('', '_blank')
  expect(popup.opener).toBeNull()
  expect(popup.location.href).toBe('https://pay.example/checkout')
  expect(popup.close).not.toHaveBeenCalled()
  read.mockResolvedValue({
    data: { success: true, data: { trade_no: 'trade1', status: 'paid' } },
  })
  await act(() => result.current.resume())
  expect(popup.close).toHaveBeenCalledOnce()
  expect(completed).not.toHaveBeenCalled()
  read.mockResolvedValue({
    data: { success: true, data: { trade_no: 'trade1', status: 'completed' } },
  })
  await act(() => result.current.resume())
  expect(completed).toHaveBeenCalledOnce()
})

it('refreshes a completed order even when the browser rejects closing the cross-origin payment window', async () => {
  const popup = {
    opener: {},
    location: { href: '' },
    closed: false,
    close: () => {
      throw new DOMException(
        'Blocked cross-origin window access',
        'SecurityError'
      )
    },
  }
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
  vi.spyOn(api, 'post')
    .mockResolvedValueOnce({ data: { success: true, data: quote } })
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          trade_no: 'popup-order',
          status: 'pending',
          payment_url: 'https://pay.example/order',
        },
      },
    })
  const read = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { trade_no: 'popup-order', status: 'pending' },
    },
  })
  const completed = vi.fn().mockResolvedValue(undefined)
  const { result } = renderHook(() => useCatfkPayment(info, 1, completed), {
    wrapper,
  })
  await act(() => result.current.selectProduct(product, channel))
  act(() => result.current.setQQ('12345'))
  await act(() => result.current.confirm())
  read.mockResolvedValue({
    data: {
      success: true,
      data: { trade_no: 'popup-order', status: 'completed' },
    },
  })
  await act(() => result.current.resume())
  expect(completed).toHaveBeenCalledOnce()
  expect(result.current.pendingTrade).toBeNull()
})

it('preserves a completed order for retry when refreshing its credited balance fails', async () => {
  localStorage.setItem('wallet:catfk:order:1', 'refresh-order')
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { trade_no: 'refresh-order', status: 'completed' },
    },
  })
  const completed = vi
    .fn()
    .mockRejectedValueOnce(new Error('Balance request failed'))
    .mockResolvedValue(undefined)
  const { result } = renderHook(() => useCatfkPayment(info, 1, completed), {
    wrapper,
  })
  await waitFor(() => expect(completed).toHaveBeenCalledOnce())
  expect(localStorage.getItem('wallet:catfk:order:1')).toBe('refresh-order')
  await act(() => result.current.resume())
  expect(completed).toHaveBeenCalledTimes(2)
  expect(result.current.pendingTrade).toBeNull()
  expect(localStorage.getItem('wallet:catfk:order:1')).toBeNull()
})

it('retries a failed balance refresh when a later order read returns the same completed status', async () => {
  localStorage.setItem('wallet:catfk:order:1', 'unchanged-order')
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { trade_no: 'unchanged-order', status: 'completed' },
    },
  })
  const completed = vi
    .fn()
    .mockRejectedValueOnce(new Error('Balance request failed'))
    .mockResolvedValue(undefined)
  const { result } = renderHook(
    () => ({
      payment: useCatfkPayment(info, 1, completed),
      client: useQueryClient(),
    }),
    { wrapper }
  )
  await waitFor(() => expect(completed).toHaveBeenCalledOnce())
  await act(() =>
    result.current.client.invalidateQueries({
      queryKey: ['wallet', 'store-order', 1, 'unchanged-order'],
    })
  )
  await waitFor(() => expect(completed).toHaveBeenCalledTimes(2))
  expect(result.current.payment.pendingTrade).toBeNull()
})

it('keeps recovery tracking until a concurrent balance refresh succeeds', async () => {
  localStorage.setItem('wallet:catfk:order:1', 'concurrent-order')
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { trade_no: 'concurrent-order', status: 'completed' },
    },
  })
  let finish!: () => void
  const completed = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const { result } = renderHook(() => useCatfkPayment(info, 1, completed), {
    wrapper,
  })
  await waitFor(() => expect(completed).toHaveBeenCalledOnce())
  await act(() => result.current.resume())
  expect(localStorage.getItem('wallet:catfk:order:1')).toBe('concurrent-order')
  await act(async () => finish())
  expect(localStorage.getItem('wallet:catfk:order:1')).toBeNull()
  expect(completed).toHaveBeenCalledOnce()
})

it('preserves the new account order when the previous account balance refresh completes late', async () => {
  localStorage.setItem('wallet:catfk:order:1', 'account-one-order')
  localStorage.setItem('wallet:catfk:order:2', 'account-two-order')
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: {
        trade_no: String(url).split('/').at(-1),
        status: String(url).endsWith('account-one-order')
          ? 'completed'
          : 'pending',
      },
    },
  }))
  let finish!: () => void
  const completed = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const { result, rerender } = renderHook(
    ({ id }) => useCatfkPayment(info, id, completed),
    { wrapper, initialProps: { id: 1 } }
  )
  await waitFor(() => expect(completed).toHaveBeenCalledOnce())
  rerender({ id: 2 })
  await act(async () => finish())
  expect(result.current.pendingTrade).toBe('account-two-order')
  expect(localStorage.getItem('wallet:catfk:order:2')).toBe('account-two-order')
})

it('keeps the payment dialog amount bound to its order when choosing another product and keeps tracking after dismissal', async () => {
  vi.spyOn(api, 'post')
    .mockResolvedValueOnce({ data: { success: true, data: quote } })
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          trade_no: 'snapshot-order',
          status: 'pending',
          payment_url: 'https://pay.example/checkout',
        },
      },
    })
    .mockResolvedValueOnce({
      data: { success: true, data: { ...quote, topup_amount: 50 } },
    })
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { trade_no: 'snapshot-order', status: 'pending' },
    },
  })
  const completed = vi.fn().mockResolvedValue(undefined)
  const { result } = renderHook(
    () => ({
      ...useCatfkPayment(info, 1, completed),
      client: useQueryClient(),
    }),
    { wrapper }
  )
  await act(() => result.current.selectProduct(product, channel))
  act(() => result.current.setQQ('12345'))
  await act(() => result.current.confirm())
  expect(result.current.statusDialogOpen).toBe(true)
  act(() => result.current.setStatusDialogOpen(false))
  get.mockResolvedValue({
    data: {
      success: true,
      data: { trade_no: 'snapshot-order', status: 'completed' },
    },
  })
  await act(() =>
    result.current.client.invalidateQueries({
      queryKey: ['wallet', 'store-order', 1, 'snapshot-order'],
    })
  )
  await waitFor(() =>
    expect(result.current.statusOrder?.status).toBe('completed')
  )
  expect(result.current.statusDialogOpen).toBe(false)
  await act(() =>
    result.current.selectProduct(
      { id: 'fifty', name: 'Fifty', amount: 50 },
      channel
    )
  )
  expect(result.current.statusOrder?.amount).toBe(10)
  expect(result.current.statusOrder?.tradeNo).toBe('snapshot-order')
  expect(completed).toHaveBeenCalledOnce()
})

it('checks a dismissed pending order immediately when returning from the external payment page', async () => {
  localStorage.setItem('wallet:catfk:order:1', 'return-order')
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { trade_no: 'return-order', status: 'pending' },
    },
  })
  const completed = vi.fn().mockResolvedValue(undefined)
  const { result } = renderHook(() => useCatfkPayment(info, 1, completed), {
    wrapper,
  })
  await waitFor(() => expect(result.current.orderStatus).toBe('pending'))
  act(() => result.current.setStatusDialogOpen(false))
  get.mockResolvedValue({
    data: {
      success: true,
      data: { trade_no: 'return-order', status: 'completed' },
    },
  })
  const callsBeforeReturn = get.mock.calls.length
  act(() => window.dispatchEvent(new Event('focus')))
  expect(get.mock.calls.length).toBeGreaterThan(callsBeforeReturn)
  await waitFor(() => expect(completed).toHaveBeenCalledOnce())
  expect(result.current.pendingTrade).toBeNull()
  expect(result.current.statusDialogOpen).toBe(false)
})

it('does not query an order again on window focus after it has completed', async () => {
  localStorage.setItem('wallet:catfk:order:1', 'done-order')
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { trade_no: 'done-order', status: 'completed' },
    },
  })
  const { result } = renderHook(() => useCatfkPayment(info, 1), { wrapper })
  await waitFor(() => expect(result.current.pendingTrade).toBeNull())
  const calls = get.mock.calls.length
  act(() => window.dispatchEvent(new Event('focus')))
  expect(get).toHaveBeenCalledTimes(calls)
})

it('automatically checks a saved order and refreshes the wallet only after completed settlement', async () => {
  localStorage.setItem('wallet:catfk:order:1', 'saved-trade')
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { trade_no: 'saved-trade', status: 'completed' },
    },
  })
  const completed = vi.fn().mockResolvedValue(undefined)
  const { result } = renderHook(() => useCatfkPayment(info, 1, completed), {
    wrapper,
  })
  await waitFor(() => expect(completed).toHaveBeenCalledOnce())
  expect(result.current.pendingTrade).toBeNull()
  expect(localStorage.getItem('wallet:catfk:order:1')).toBeNull()
})

it('keeps a known payment link recoverable when popup creation is blocked without resubmitting', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValueOnce({ data: { success: true, data: quote } })
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          trade_no: 'blocked-trade',
          status: 'pending',
          payment_url: 'https://pay.example/same-order',
        },
      },
    })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        trade_no: 'blocked-trade',
        status: 'pending',
        payment_url: 'https://pay.example/same-order',
      },
    },
  })
  const { result } = renderHook(() => useCatfkPayment(info, 1), { wrapper })
  act(() => result.current.selectChannel(channel))
  await act(() => result.current.selectProduct(product))
  act(() => result.current.setQQ('12345'))
  await act(() => result.current.confirm())
  expect(result.current.paymentUrl).toBe('https://pay.example/same-order')
  await act(() => result.current.resume())
  expect(result.current.paymentUrl).toBe('https://pay.example/same-order')
  expect(post).toHaveBeenCalledTimes(2)
})

it('accepts only ASCII digit QQ strings and HTTPS payment URLs without credentials', () => {
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
  act(() => result.current.setQQ('12345'))
  await act(() => result.current.confirm())
  expect(result.current.qq).toBe('12345')
  expect(result.current.uncertain).toBe(false)
  expect(localStorage.getItem('wallet:catfk:order:1')).toBeNull()
  act(() => result.current.setQQ('56789'))
  await act(() => result.current.confirm())
  expect(post.mock.calls[2][1]).toMatchObject({
    qq: '56789',
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
    act(() => result.current.setQQ('12345'))
    await act(() => result.current.confirm())
    expect(result.current.qq).toBe('12345')
    expect(result.current.uncertain).toBe(true)
    expect(localStorage.getItem('wallet:catfk:order:1')).toBe(
      'creation_unknown'
    )
    act(() => result.current.setQQ('56789'))
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
  expect(result.current.statusOrder).toBeNull()
  expect(result.current.statusDialogOpen).toBe(false)
  expect(result.current.qq).toBe('')
  expect(result.current.quote).toBeNull()
  expect(result.current.channel).toBeNull()
  expect(result.current.open).toBe(false)
})
