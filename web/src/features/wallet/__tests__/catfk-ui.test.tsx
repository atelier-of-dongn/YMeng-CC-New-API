import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ComponentProps, type ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { BillingHistoryDialog } from '../components/dialogs/billing-history-dialog'
import { PaymentConfirmDialog } from '../components/dialogs/payment-confirm-dialog'
import { RechargeFormCard } from '../components/recharge-form-card'
import { useCatfkPayment } from '../hooks/use-catfk-payment'
import { useTopupInfo } from '../hooks/use-topup-info'
import type { TopupInfo } from '../types'

const channel = { id: 'wechat', name: 'WeChat' }
const product = { id: 'ten', name: 'Ten dollars', amount: 10 }
const quote = { quote_id: 'q1', amount: 72, currency: 'CNY', topup_amount: 10 }
const topupInfo: TopupInfo = {
  enable_online_topup: false,
  enable_stripe_topup: false,
  pay_methods: [],
  min_topup: 1,
  stripe_min_topup: 1,
  amount_options: [20],
  discount: {},
  catfk: {
    enabled: true,
    available: true,
    products: [product],
    channels: [channel],
  },
}
const base: ComponentProps<typeof RechargeFormCard> = {
  topupInfo,
  presetAmounts: [{ value: 10 }, { value: 20 }],
  selectedPreset: 10,
  onSelectPreset: vi.fn(),
  topupAmount: 10,
  onTopupAmountChange: vi.fn(),
  paymentAmount: 140,
  calculating: false,
  onPaymentMethodSelect: vi.fn(),
  paymentLoading: null,
  redemptionCode: '',
  onRedemptionCodeChange: vi.fn(),
  onRedeem: vi.fn(),
  redeeming: false,
}
function wrapper(props: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {props.children}
    </QueryClientProvider>
  )
}
afterEach(() => {
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
  localStorage.clear()
  vi.restoreAllMocks()
})

it('places store channels in the same payment grid with identical button styling and no provider heading', () => {
  render(
    <RechargeFormCard
      {...base}
      topupInfo={{
        ...topupInfo,
        enable_online_topup: true,
        pay_methods: [
          { type: 'alipay', name: 'Existing Alipay' },
          { type: 'catfk', name: 'WeChat' },
        ],
      }}
      onCatfkPaymentSelect={vi.fn()}
    />
  )
  const regular = screen.getByRole('button', { name: 'Existing Alipay' })
  const store = screen.getByRole('button', { name: 'WeChat' })
  expect(store.parentElement).toBe(regular.parentElement)
  expect(store.className).toBe(regular.className)
  expect(screen.queryByText('Catfk Payment')).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'WeChat' })).toHaveLength(1)
})

it('uses the original preset buttons and keeps custom input visible while quoting the selected amount', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: quote },
  })
  function WalletAmounts() {
    const payment = useCatfkPayment(topupInfo.catfk, 1)
    return (
      <>
        <RechargeFormCard
          {...base}
          catfkChannel={payment.channel}
          onCatfkPaymentSelect={(selectedChannel, selectedProduct) =>
            payment.selectProduct(selectedProduct, selectedChannel)
          }
        />
        <PaymentConfirmDialog
          open={payment.open}
          onOpenChange={(open) => {
            if (!open) payment.reset()
          }}
          onConfirm={payment.confirm}
          topupAmount={payment.product?.amount ?? 0}
          paymentAmount={payment.quote?.amount ?? 0}
          paymentMethod={
            payment.channel ? { ...payment.channel, type: 'catfk' } : undefined
          }
          calculating={payment.calculating}
          processing={payment.processing}
          catfk={{
            quote: payment.quote,
            qq: payment.qq,
            onQQChange: payment.setQQ,
            available: true,
          }}
        />
      </>
    )
  }
  const user = userEvent.setup()
  render(<WalletAmounts />, { wrapper })
  const preset = screen.getByRole('button', { name: /^10 Pay/ })
  const presetText = preset.textContent
  expect(
    screen.getByRole('spinbutton', { name: 'Custom Amount' })
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: /WeChat/ }))
  await screen.findByRole('textbox', { name: 'QQ number' })
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/user/catfk/quote', {
      product_id: 'ten',
      channel_id: 'wechat',
    })
  )
  expect(preset.textContent).toBe(presetText)
  expect(
    screen.queryByRole('button', { name: /Ten dollars/ })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('button', { name: /^10 Pay/ })).toHaveClass(
    'border-foreground'
  )
  expect(
    screen.getByRole('spinbutton', { name: 'Custom Amount' })
  ).toBeVisible()
  expect(post).toHaveBeenCalledOnce()
})

it('disables the store method for custom input even matching a tier and re-enables it after selecting a mapped preset', async () => {
  const pay = vi.fn()
  const regularPay = vi.fn()
  function WalletAmounts() {
    const [amount, setAmount] = useState(10)
    const [preset, setPreset] = useState<number | null>(10)
    return (
      <RechargeFormCard
        {...base}
        topupInfo={{
          ...topupInfo,
          enable_online_topup: true,
          pay_methods: [{ type: 'alipay', name: 'Existing Alipay' }],
        }}
        topupAmount={amount}
        selectedPreset={preset}
        onSelectPreset={(next) => {
          setAmount(next.value)
          setPreset(next.value)
        }}
        onTopupAmountChange={(next) => {
          setAmount(next)
          setPreset(null)
        }}
        onCatfkPaymentSelect={pay}
        onPaymentMethodSelect={regularPay}
      />
    )
  }
  const user = userEvent.setup()
  render(<WalletAmounts />)
  const store = screen.getByRole('button', { name: /WeChat/ })
  expect(store).toBeEnabled()
  const note = screen.getByText('Custom amounts are not supported')
  expect(note).toHaveClass(
    'text-[11px]',
    'text-muted-foreground',
    'font-normal'
  )
  const input = screen.getByRole('spinbutton', { name: 'Custom Amount' })
  await user.clear(input)
  await user.type(input, '10')
  expect(screen.getByRole('button', { name: /WeChat/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Existing Alipay' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Existing Alipay' }))
  expect(regularPay).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'alipay' })
  )
  await user.click(screen.getByRole('button', { name: /^10 Pay/ }))
  expect(screen.getByRole('button', { name: /WeChat/ })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: /WeChat/ }))
  expect(pay).toHaveBeenCalledWith(channel, product)
})

it('disables an unmapped preset without replacing the shared amount buttons', () => {
  render(<RechargeFormCard {...base} selectedPreset={20} topupAmount={20} />)
  expect(screen.getByRole('button', { name: /WeChat/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: /^20 Pay/ })).toBeEnabled()
})

it('displays the server unavailable reason and disables the store method without disabling shared presets', () => {
  render(
    <RechargeFormCard
      {...base}
      topupInfo={{
        ...topupInfo,
        catfk: {
          enabled: true,
          products: [product],
          channels: [channel],
          available: false,
          unavailable_reason: 'Protocol not verified',
        },
      }}
    />
  )
  expect(screen.getByText('Protocol not verified')).toBeVisible()
  expect(screen.getByRole('button', { name: /WeChat/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: /^10 Pay/ })).toBeEnabled()
})

it('preserves the configured store method name and icon when loading payment settings', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        ...topupInfo,
        pay_methods: [
          {
            type: 'catfk',
            name: 'Configured Alipay',
            icon: 'https://example.com/alipay.png',
          },
        ],
      },
    },
  })
  function LoadedMethods() {
    const info = useTopupInfo()
    return (
      <RechargeFormCard
        {...base}
        topupInfo={info.topupInfo}
        presetAmounts={info.presetAmounts}
        loading={info.loading}
      />
    )
  }
  render(<LoadedMethods />)
  const method = await screen.findByRole('button', {
    name: /Configured Alipay/,
  })
  expect(method).toBeVisible()
  expect(
    screen.getByRole('img', { name: 'Configured Alipay' })
  ).toHaveAttribute('src', 'https://example.com/alipay.png')
})
it('requires a valid quote and ASCII QQ before confirmation and locks QQ for uncertain orders', async () => {
  const confirm = vi.fn()
  function Payment() {
    const [qq, setQQ] = useState('')
    return (
      <PaymentConfirmDialog
        open
        onOpenChange={vi.fn()}
        onConfirm={confirm}
        topupAmount={10}
        paymentAmount={72}
        paymentMethod={{ type: 'catfk', name: 'WeChat' }}
        calculating={false}
        processing={false}
        catfk={{ quote, qq, onQQChange: setQQ, available: true }}
      />
    )
  }
  const user = userEvent.setup()
  render(<Payment />)
  const button = screen.getByRole('button', { name: 'Confirm Payment' })
  const input = screen.getByRole('textbox', { name: 'QQ number' })
  expect(button).toBeDisabled()
  await user.type(input, '１２３')
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(button).toBeDisabled()
  await user.clear(input)
  await user.type(input, '001234')
  expect(input).toHaveAttribute('aria-invalid', 'false')
  expect(button).toBeEnabled()
  await user.click(button)
  expect(confirm).toHaveBeenCalledOnce()
  expect(screen.getByRole('alertdialog')).toBeVisible()
})
it.each([
  { calculating: true, valid: true, available: true },
  { calculating: false, valid: false, available: true },
  { calculating: false, valid: true, available: false },
])(
  'disables confirmation for incomplete, invalid or unavailable quotes: %j',
  (state) => {
    render(
      <PaymentConfirmDialog
        open
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        topupAmount={10}
        paymentAmount={72}
        paymentMethod={undefined}
        calculating={state.calculating}
        processing={false}
        catfk={{
          quote: state.valid ? quote : null,
          qq: '1234',
          onQQChange: vi.fn(),
          available: state.available,
          qqLocked: true,
        }}
      />
    )
    expect(
      screen.getByRole('button', { name: 'Confirm Payment' })
    ).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'QQ number' })).toBeDisabled()
  }
)
it('formats Catfk history quota once and recovers an order through the server without local storage', async () => {
  useSystemConfigStore.getState().setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG, quotaPerUnit: 500000 },
  })
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (String(url).includes('/catfk/orders/')) {
      return {
        data: {
          success: true,
          data: { trade_no: 'catfk-order', status: 'paid' },
        },
      }
    }
    return {
      data: {
        success: true,
        data: {
          total: 2,
          items: [
            {
              id: 1,
              amount: 5000000,
              money: 72,
              trade_no: 'catfk-order',
              payment_method: 'catfk',
              payment_provider: 'catfk',
              status: 'pending',
              create_time: 1,
            },
            {
              id: 2,
              amount: 10,
              money: 72,
              trade_no: 'epay-order',
              payment_method: 'alipay',
              status: 'success',
              create_time: 1,
            },
          ],
        },
      },
    }
  })
  const onCompleted = vi.fn()
  render(
    <BillingHistoryDialog
      open
      onOpenChange={vi.fn()}
      onCatfkCompleted={onCompleted}
    />,
    { wrapper }
  )
  await screen.findByText('catfk-order')
  expect(screen.getAllByText('$10')).toHaveLength(2)
  await userEvent.click(screen.getByRole('button', { name: 'Resume payment' }))
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Payment received. Wallet credit is pending.'
    )
  )
  expect(get).toHaveBeenCalledWith('/api/user/catfk/orders/catfk-order')
  expect(onCompleted).not.toHaveBeenCalled()
  expect(localStorage.getItem('wallet:catfk:order:1')).toBeNull()
})
