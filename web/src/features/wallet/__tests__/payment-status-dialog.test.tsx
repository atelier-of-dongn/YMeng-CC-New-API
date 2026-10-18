import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { useState, type ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { CatfkPaymentStatusDialog } from '../components/dialogs/catfk-payment-status-dialog'
import { PaymentConfirmDialog } from '../components/dialogs/payment-confirm-dialog'
import { useCatfkPayment } from '../hooks/use-catfk-payment'

const channel = { id: 'alipay', name: 'Alipay' }
const product = { id: 'cat-10', name: 'Ten', amount: 10 }
const quote = {
  quote_id: 'quote',
  amount: 10.18,
  currency: 'CNY',
  topup_amount: 10,
}
const paymentUrl = 'https://pay.example/checkout'
const info = {
  enabled: true,
  available: true,
  channels: [channel],
  products: [product],
}
const clients: QueryClient[] = []
function Wrapper(props: { children: ReactNode }) {
  const [client] = useState(() => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    clients.push(client)
    return client
  })
  return (
    <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
  )
}
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
  localStorage.clear()
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
  vi.restoreAllMocks()
})

it.each([true, false])(
  'keeps automatic payment navigation when popup availability is %s and shows a same-order fallback until confirmed credit',
  async (popupAllowed) => {
    const popup = { opener: {}, location: { href: '' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(
      popupAllowed ? (popup as unknown as Window) : null
    )
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValueOnce({ data: { success: true, data: quote } })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            trade_no: 'order',
            status: 'pending',
            payment_url: paymentUrl,
          },
        },
      })
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: { trade_no: 'order', status: 'pending' } },
    })
    const credited = vi.fn().mockResolvedValue(undefined)
    let check!: () => Promise<void>
    function Payment() {
      const client = useQueryClient()
      const payment = useCatfkPayment(info, 1, credited)
      check = () =>
        client.invalidateQueries({
          queryKey: ['wallet', 'store-order', 1, 'order'],
        })
      return (
        <>
          <button
            type='button'
            onClick={() => void payment.selectProduct(product, channel)}
          >
            Start
          </button>
          <PaymentConfirmDialog
            open={payment.open}
            onOpenChange={() => payment.reset()}
            onConfirm={payment.confirm}
            topupAmount={payment.product?.amount ?? 0}
            paymentAmount={payment.quote?.amount ?? 0}
            paymentMethod={{ type: 'catfk', name: 'Alipay' }}
            calculating={payment.calculating}
            processing={payment.processing}
            catfk={{
              quote: payment.quote,
              qq: payment.qq,
              onQQChange: payment.setQQ,
              available: true,
            }}
          />
          <CatfkPaymentStatusDialog
            open={payment.statusDialogOpen}
            onOpenChange={payment.setStatusDialogOpen}
            order={payment.statusOrder}
            checking={payment.resuming}
            queryFailed={payment.statusQueryFailed}
            onCheck={payment.resume}
          />
        </>
      )
    }
    const user = userEvent.setup()
    render(<Payment />, { wrapper: Wrapper })
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await user.type(
      await screen.findByRole('textbox', { name: /Contact method/ }),
      '12345'
    )
    await user.click(screen.getByRole('button', { name: 'Confirm Payment' }))
    const waiting = await screen.findByRole('dialog', {
      name: 'Waiting for payment confirmation',
    })
    if (popupAllowed) expect(popup.location.href).toBe(paymentUrl)
    expect(within(waiting).getByText('$10')).toBeVisible()
    const fallback = within(waiting).getByRole('link', {
      name: 'Click here if payment did not open',
    })
    expect(fallback).toHaveAttribute('href', paymentUrl)
    expect(fallback).toHaveAttribute('target', '_blank')
    expect(fallback).toHaveAttribute('rel', 'noopener noreferrer')
    expect(fallback).toHaveClass('text-xs')
    await user.click(fallback)
    expect(post).toHaveBeenCalledTimes(2)

    get.mockResolvedValue({
      data: { success: true, data: { trade_no: 'order', status: 'paid' } },
    })
    await act(() => check())
    await waitFor(() =>
      expect(within(waiting).getByRole('status')).toHaveTextContent(
        'Payment received. Wallet credit is pending.'
      )
    )
    expect(within(waiting).queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText('Payment successful')).not.toBeInTheDocument()
    expect(credited).not.toHaveBeenCalled()

    get.mockResolvedValue({
      data: { success: true, data: { trade_no: 'order', status: 'completed' } },
    })
    await act(() => check())
    const success = await screen.findByRole('dialog', {
      name: 'Payment successful',
    })
    expect(within(success).getByRole('status')).toHaveTextContent(
      'Automatically credited $10. No redemption needed.'
    )
    expect(within(success).queryByRole('link')).not.toBeInTheDocument()
    await waitFor(() => expect(credited).toHaveBeenCalledOnce())
    await user.click(within(success).getByRole('button', { name: 'Close' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
  }
)

it.each(['pending', 'paid', 'needs_attention', 'expired', 'creation_unknown'])(
  'never claims automatic credit for a %s order',
  (status) => {
    render(
      <CatfkPaymentStatusDialog
        open
        onOpenChange={vi.fn()}
        order={{ tradeNo: 'order', amount: 10, status, paymentUrl }}
        checking={false}
        queryFailed={false}
        onCheck={vi.fn()}
      />
    )
    expect(screen.queryByText('Payment successful')).not.toBeInTheDocument()
    expect(screen.queryByText(/Automatically credited/)).not.toBeInTheDocument()
    if (status !== 'pending') {
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    }
  }
)

it('shows a recoverable query error and keeps the safe fallback available without claiming payment', async () => {
  const check = vi.fn()
  render(
    <CatfkPaymentStatusDialog
      open
      onOpenChange={vi.fn()}
      order={{ tradeNo: 'order', amount: 10, status: 'pending', paymentUrl }}
      checking={false}
      queryFailed
      onCheck={check}
    />
  )
  expect(
    screen.getByText('Unable to check payment status. Retrying automatically.')
  ).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Check status' }))
  expect(check).toHaveBeenCalledOnce()
  expect(screen.getByRole('link')).toHaveAttribute('href', paymentUrl)
})

it.each(['zhCN', 'zhTW', 'en', 'fr', 'ru', 'ja', 'vi', 'invalid_locale!'])(
  'uses the site currency and responds to language switching for %s',
  async (language) => {
    const i18n = createInstance()
    await i18n.init({ lng: language, fallbackLng: false, resources: {} })
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType: 'CNY',
        usdExchangeRate: 7,
      },
    })
    render(
      <I18nextProvider i18n={i18n}>
        <CatfkPaymentStatusDialog
          open
          onOpenChange={vi.fn()}
          order={{
            tradeNo: 'order',
            amount: 10.25,
            status: 'completed',
            paymentUrl: null,
          }}
          checking={false}
          queryFailed={false}
          onCheck={vi.fn()}
        />
      </I18nextProvider>
    )
    expect(screen.getByRole('status')).toHaveTextContent(/71[.,]75/)
    await act(() => i18n.changeLanguage('fr'))
    expect(screen.getByRole('status')).toHaveTextContent(/71,75\s¥/)
    await act(() => i18n.changeLanguage('en'))
    expect(screen.getByRole('status')).toHaveTextContent('¥71.75')
    act(() =>
      useSystemConfigStore.getState().setConfig({
        currency: {
          ...DEFAULT_CURRENCY_CONFIG,
          quotaDisplayType: 'CUSTOM',
          customCurrencySymbol: '€',
          customCurrencyExchangeRate: 2,
        },
      })
    )
    expect(screen.getByRole('status')).toHaveTextContent('€ 20.5')
  }
)

it('omits unsafe payment links and supports dismissing with Escape', async () => {
  function Payment() {
    const [open, setOpen] = useState(true)
    return (
      <CatfkPaymentStatusDialog
        open={open}
        onOpenChange={setOpen}
        order={{
          tradeNo: 'order',
          amount: 10,
          status: 'pending',
          paymentUrl: 'javascript:alert(1)',
        }}
        checking={false}
        queryFailed={false}
        onCheck={vi.fn()}
      />
    )
  }
  render(<Payment />)
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})
