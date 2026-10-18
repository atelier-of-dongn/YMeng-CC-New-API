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
import type { CatfkChannel, TopupInfo } from '../types'

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
  presetAmounts: [{ value: 20 }],
  selectedPreset: null,
  onSelectPreset: vi.fn(),
  topupAmount: 20,
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
})

it('shows no arbitrary amount for a Catfk-only wallet and uses the original grid after channel selection', async () => {
  function WalletAmounts() {
    const [selected, select] = useState<CatfkChannel | null>(null)
    return (
      <RechargeFormCard
        {...base}
        catfkChannel={selected}
        onCatfkChannelSelect={select}
      />
    )
  }
  const user = userEvent.setup()
  render(<WalletAmounts />)
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^20 / })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'WeChat' }))
  expect(screen.getByRole('button', { name: 'WeChat' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(screen.getByRole('button', { name: /Ten dollars/ })).toHaveTextContent(
    '$10.00'
  )
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
})
it('preserves the arbitrary amount when switching from Catfk back to another payment method', async () => {
  function WalletAmounts() {
    const [selected, select] = useState<CatfkChannel | null>(channel)
    return (
      <RechargeFormCard
        {...base}
        topupInfo={{ ...topupInfo, enable_online_topup: true }}
        catfkChannel={selected}
        onCatfkChannelSelect={select}
      />
    )
  }
  render(<WalletAmounts />)
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Custom Amount' }))
  expect(screen.getByRole('spinbutton', { name: 'Custom Amount' })).toHaveValue(
    20
  )
  expect(
    screen.queryByRole('button', { name: /Ten dollars/ })
  ).not.toBeInTheDocument()
})
it('displays the server unavailable reason and disables fixed amounts', () => {
  render(
    <RechargeFormCard
      {...base}
      catfkChannel={channel}
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
  expect(screen.getByRole('button', { name: /Ten dollars/ })).toBeDisabled()
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
  await userEvent.click(
    screen.getByRole('button', { name: 'Resume Catfk payment' })
  )
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Catfk payment received. Wallet credit is pending.'
    )
  )
  expect(get).toHaveBeenCalledWith('/api/user/catfk/orders/catfk-order')
  expect(onCompleted).not.toHaveBeenCalled()
  expect(localStorage.getItem('wallet:catfk:order:1')).toBeNull()
})
