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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  fee: 0.18,
  fee_rate: 1.8,
}
const paidAmount = { amount: 10.18, fee: 0.18, fee_rate: 1.8 }
const paymentQrCode = 'https://qr.alipay.com/upx-code'
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

it('shows the payment QR code in the site without opening the payment page until confirmed credit', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValueOnce({ data: { success: true, data: quote } })
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          trade_no: 'order',
          status: 'pending',
          payment_qr_code: paymentQrCode,
        },
      },
    })
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { trade_no: 'order', status: 'pending' },
    },
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
          open={!!payment.statusOrder}
          onOpenChange={(open) => {
            if (!open) payment.closeStatus()
          }}
          order={payment.statusOrder}
          queryFailed={payment.statusQueryFailed}
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
  expect(await screen.findByText('Includes a 1.8% fee (0.18)')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Confirm Payment' }))
  const waiting = await screen.findByRole('dialog', {
    name: 'Scan with Alipay to pay',
  })
  expect(open).not.toHaveBeenCalled()
  expect(within(waiting).getByText('$10')).toBeVisible()
  expect(within(waiting).getByText('10.18')).toBeVisible()
  expect(within(waiting).getByText('Includes a 1.8% fee (0.18)')).toBeVisible()
  expect(
    within(waiting).getByRole('img', { name: 'Payment QR code' })
  ).toBeVisible()
  expect(within(waiting).queryByRole('link')).not.toBeInTheDocument()
  expect(post).toHaveBeenCalledTimes(2)

  get.mockResolvedValue({
    data: {
      success: true,
      data: { trade_no: 'order', status: 'paid' },
    },
  })
  await act(() => check())
  await waitFor(() =>
    expect(within(waiting).getByRole('status')).toHaveTextContent(
      'Payment received. Wallet credit is pending.'
    )
  )
  expect(
    within(waiting).queryByRole('img', { name: 'Payment QR code' })
  ).not.toBeInTheDocument()
  expect(screen.queryByText('Payment successful')).not.toBeInTheDocument()
  expect(credited).not.toHaveBeenCalled()

  get.mockResolvedValue({
    data: {
      success: true,
      data: { trade_no: 'order', status: 'completed' },
    },
  })
  await act(() => check())
  const success = await screen.findByRole('dialog', {
    name: 'Payment successful',
  })
  expect(within(success).getByRole('status')).toHaveTextContent('+$10')
  expect(within(success).queryByText(/No redemption needed/)).toBeNull()
  expect(within(success).queryByRole('link')).not.toBeInTheDocument()
  await waitFor(() => expect(credited).toHaveBeenCalledOnce())
  expect(within(success).getAllByRole('button')).toHaveLength(1)
  await user.click(within(success).getByRole('button', { name: 'Done' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})

it.each(['pending', 'paid', 'needs_attention', 'expired', 'creation_unknown'])(
  'never claims automatic credit for a %s order',
  (status) => {
    render(
      <CatfkPaymentStatusDialog
        open
        onOpenChange={vi.fn()}
        order={{
          tradeNo: 'order',
          channelName: 'Alipay',
          payment: paidAmount,
          amount: 10,
          status,
          paymentQrCode,
        }}
        queryFailed={false}
      />
    )
    expect(screen.queryByText('Payment successful')).not.toBeInTheDocument()
    if (status !== 'pending') {
      expect(
        screen.queryByRole('img', { name: 'Payment QR code' })
      ).not.toBeInTheDocument()
    }
  }
)

it('keeps only the amount, the QR code and a cancel button while waiting, and cancel just closes the dialog', async () => {
  const onOpenChange = vi.fn()
  render(
    <CatfkPaymentStatusDialog
      open
      onOpenChange={onOpenChange}
      order={{
        tradeNo: 'order',
        channelName: 'Alipay',
        payment: paidAmount,
        amount: 10,
        status: 'pending',
        paymentQrCode,
      }}
      queryFailed
    />
  )
  const dialog = screen.getByRole('dialog', { name: 'Scan with Alipay to pay' })
  expect(within(dialog).getByText('$10')).toBeVisible()
  expect(
    within(dialog).getByRole('img', { name: 'Payment QR code' })
  ).toBeVisible()
  expect(
    within(dialog)
      .getAllByRole('button')
      .map((button) => button.textContent)
  ).toEqual(['Cancel payment'])
  expect(within(dialog).queryByRole('link')).not.toBeInTheDocument()
  expect(within(dialog).queryByRole('status')).not.toBeInTheDocument()
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Cancel payment' })
  )
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

it('asks to scan with WeChat while a WeChat order waits', () => {
  render(
    <CatfkPaymentStatusDialog
      open
      onOpenChange={vi.fn()}
      order={{
        tradeNo: 'order',
        channelName: '微信支付',
        payment: paidAmount,
        amount: 10,
        status: 'pending',
        paymentQrCode: 'https://catfk.com/shopApi/Pay/payment?trade_no=CAT1',
      }}
      queryFailed={false}
    />
  )
  expect(
    screen.getByRole('dialog', { name: 'Scan with WeChat to pay' })
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Save QR code' })
  ).not.toBeInTheDocument()
})

describe('on a phone', () => {
  const desktopWidth = window.innerWidth
  beforeEach(() => {
    window.innerWidth = 375
  })
  afterEach(() => {
    window.innerWidth = desktopWidth
  })

  it('offers opening Alipay directly for a scraped Alipay code', () => {
    render(
      <CatfkPaymentStatusDialog
        open
        onOpenChange={vi.fn()}
        order={{
          tradeNo: 'order',
          channelName: 'Alipay',
          payment: paidAmount,
          amount: 10,
          status: 'pending',
          paymentQrCode,
        }}
        queryFailed={false}
      />
    )
    const link = screen.getByRole('button', { name: 'Open Alipay to pay' })
    expect(link).toHaveAttribute('href', paymentQrCode)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('offers no Alipay button when the code is the fallback payment page', () => {
    render(
      <CatfkPaymentStatusDialog
        open
        onOpenChange={vi.fn()}
        order={{
          tradeNo: 'order',
          channelName: 'Alipay',
          payment: paidAmount,
          amount: 10,
          status: 'pending',
          paymentQrCode: 'https://catfk.com/shopApi/Pay/payment?trade_no=CAT1',
        }}
        queryFailed={false}
      />
    )
    expect(screen.getByRole('img', { name: 'Payment QR code' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Open Alipay to pay' })
    ).not.toBeInTheDocument()
  })

  it('saves the WeChat QR code as an image to scan from the photo album', async () => {
    const blob = new Blob(['png'], { type: 'image/png' })
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      (callback) => callback(blob)
    )
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:qr')
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {})
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
    render(
      <CatfkPaymentStatusDialog
        open
        onOpenChange={vi.fn()}
        order={{
          tradeNo: 'order',
          channelName: 'WeChat Pay',
          payment: paidAmount,
          amount: 10,
          status: 'pending',
          paymentQrCode: 'https://catfk.com/shopApi/Pay/payment?trade_no=CAT1',
        }}
        queryFailed={false}
      />
    )
    expect(
      screen.queryByRole('button', { name: 'Open Alipay to pay' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'Save the QR code, then scan it from your photo album in WeChat'
      )
    ).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Save QR code' }))
    expect(createObjectURL).toHaveBeenCalledWith(blob)
    const anchor = click.mock.contexts[0] as HTMLAnchorElement
    expect(anchor.download).toBe('payment-qr-code.png')
    expect(anchor.href).toBe('blob:qr')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:qr')
  })
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
            channelName: 'Alipay',
            payment: paidAmount,
            amount: 10.25,
            status: 'completed',
            paymentQrCode: null,
          }}
          queryFailed={false}
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

it('omits unsafe QR codes and supports dismissing with Escape', async () => {
  function Payment() {
    const [open, setOpen] = useState(true)
    return (
      <CatfkPaymentStatusDialog
        open={open}
        onOpenChange={setOpen}
        order={{
          tradeNo: 'order',
          channelName: 'Alipay',
          payment: paidAmount,
          amount: 10,
          status: 'pending',
          paymentQrCode: 'javascript:alert(1)',
        }}
        queryFailed={false}
      />
    )
  }
  render(<Payment />)
  expect(
    screen.queryByRole('img', { name: 'Payment QR code' })
  ).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})
