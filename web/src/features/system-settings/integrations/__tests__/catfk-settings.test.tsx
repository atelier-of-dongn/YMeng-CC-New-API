import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { toast } from 'sonner'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import {
  CatFKSettingsFields,
  type CatFKFormValues,
} from '../catfk-settings-fields'
import { CatFKSetupGuide } from '../catfk-setup-guide'
import { PaymentMethodDialog } from '../payment-method-dialog'
import { PaymentMethodsVisualEditor } from '../payment-methods-visual-editor'
import { PaymentSettingsSection } from '../payment-settings-section'

const defaults: CatFKFormValues = {
  CatFKEnabled: false,
  CatFKStoreToken: '',
  CatFKProducts: '[]',
  CatFKChannels: '[]',
}
function Fixture(props: { initial?: Partial<CatFKFormValues> }) {
  const [values, setValues] = useState({ ...defaults, ...props.initial })
  return (
    <CatFKSettingsFields
      values={values}
      complianceConfirmed
      onChange={(key, value) =>
        setValues((current) => ({ ...current, [key]: value }))
      }
    />
  )
}
function Wrapper(props: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      })
  )
  return (
    <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
  )
}
afterEach(() => vi.restoreAllMocks())

test('store settings have a standalone tab and preserve edited fields when switching back to General', async () => {
  render(
    <PaymentSettingsSection
      defaultValues={{
        PayAddress: '',
        EpayId: '',
        EpayKey: '',
        Price: 1,
        MinTopUp: 1,
        CustomCallbackAddress: '',
        PayMethods: '[]',
        AmountOptions: '[]',
        AmountDiscount: '{}',
        StripeApiSecret: '',
        StripeWebhookSecret: '',
        StripePriceId: '',
        StripeUnitPrice: 1,
        StripeMinTopUp: 1,
        StripePromotionCodesEnabled: false,
        CreemApiKey: '',
        CreemWebhookSecret: '',
        CreemTestMode: false,
        CreemProducts: '[]',
        ...defaults,
      }}
      waffoDefaultValues={{
        WaffoEnabled: false,
        WaffoApiKey: '',
        WaffoPrivateKey: '',
        WaffoPublicCert: '',
        WaffoSandboxPublicCert: '',
        WaffoSandboxApiKey: '',
        WaffoSandboxPrivateKey: '',
        WaffoSandbox: false,
        WaffoMerchantId: '',
        WaffoCurrency: 'USD',
        WaffoUnitPrice: 1,
        WaffoMinTopUp: 1,
        WaffoNotifyUrl: '',
        WaffoReturnUrl: '',
        WaffoPayMethods: '[]',
      }}
      waffoPancakeDefaultValues={{
        WaffoPancakeMerchantID: '',
        WaffoPancakePrivateKey: '',
        WaffoPancakeReturnURL: '',
      }}
      complianceDefaults={{
        confirmed: true,
        termsVersion: 'v1',
        confirmedAt: 0,
        confirmedBy: 1,
      }}
    />,
    { wrapper: Wrapper }
  )
  expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  const storeTab = screen.getByRole('tab', {
    name: 'Yunmao consignment store payments',
  })
  expect(storeTab).toHaveAttribute('aria-selected', 'false')
  expect(
    screen.queryByRole('button', { name: 'Store payment settings' })
  ).not.toBeInTheDocument()
  await userEvent.click(storeTab)
  expect(storeTab).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('button', { name: 'Setup guide' })).toBeVisible()
  expect(screen.getByRole('tablist')).toHaveClass('min-w-max')
  await userEvent.keyboard('{ArrowLeft}{Enter}')
  expect(screen.getByRole('tab', { name: 'Creem' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await userEvent.keyboard('{ArrowRight}{Enter}')
  expect(storeTab).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('switch', { name: 'Enable CatFK' })).toBeVisible()
  await userEvent.type(screen.getByLabelText('CatFK store token'), 'my-shop')
  await userEvent.click(screen.getByRole('tab', { name: 'General' }))
  expect(
    screen.queryByRole('switch', { name: 'Enable CatFK' })
  ).not.toBeInTheDocument()
  await userEvent.click(storeTab)
  expect(screen.getByLabelText('CatFK store token')).toHaveValue('my-shop')
})

test('clicking Setup guide opens the token and goods key steps, links to the merchant console in a new tab, and Close dismisses it', async () => {
  const user = userEvent.setup()
  render(<CatFKSetupGuide />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Setup guide' }))
  const dialog = await screen.findByRole('dialog', {
    name: 'Yunmao payment setup guide',
  })
  expect(
    within(dialog).getByRole('heading', { name: 'Get the store token' })
  ).toBeVisible()
  expect(
    within(dialog).getByRole('heading', { name: 'Add product mappings' })
  ).toBeVisible()
  const link = within(dialog).getByRole('link', {
    name: 'Open Yunmao merchant console',
  })
  expect(link).toHaveAttribute('href', 'https://catfk.com/merchant')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  await user.click(within(dialog).getByRole('button', { name: 'Close' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})

test('adding a store payment uses the normal payment method dialog and preserves the existing Alipay option', async () => {
  const user = userEvent.setup()
  const save = vi.fn()
  render(<PaymentMethodDialog open onOpenChange={vi.fn()} onSave={save} />)
  await user.click(screen.getByRole('combobox', { name: 'Payment type key' }))
  expect(
    await screen.findByRole('option', { name: /Epay: alipay/ })
  ).toBeVisible()
  await user.click(
    screen.getByRole('option', { name: 'Yunmao consignment store payments' })
  )
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Alipay')
  await user.click(screen.getByRole('button', { name: 'Add' }))
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'catfk', name: 'Alipay', icon: 'SiAlipay' })
  )
})

test('the General payment method editor keeps store payments as a normal method without embedding gateway configuration', () => {
  render(<PaymentMethodsVisualEditor value='[]' onChange={vi.fn()} />)
  expect(
    screen.queryByRole('button', { name: 'Store payment settings' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('switch', { name: 'Enable CatFK' })
  ).not.toBeInTheDocument()
})

test('adding, editing and confirming deletion update the visible mapping while preserving its stable ID', async () => {
  const user = userEvent.setup()
  render(<Fixture />, { wrapper: Wrapper })
  await user.click(screen.getByRole('button', { name: 'Add product' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Stable product ID' }),
    'basic'
  )
  await user.type(
    screen.getByRole('textbox', { name: 'Product Name' }),
    'Basic'
  )
  await user.type(
    screen.getByRole('textbox', { name: 'CatFK goods key' }),
    'goods-basic'
  )
  const amount = screen.getByRole('spinbutton', {
    name: 'Expected credited balance (USD)',
  })
  await user.clear(amount)
  await user.type(amount, '12.5')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Basic (basic)')).toBeVisible()
  await user.click(
    screen.getByRole('button', { name: 'Edit CatFK product Basic' })
  )
  expect(
    screen.getByRole('textbox', { name: 'Stable product ID' })
  ).toBeDisabled()
  expect(
    screen.getByRole('spinbutton', { name: 'Expected credited balance (USD)' })
  ).toHaveValue(12.5)
  await user.clear(screen.getByRole('textbox', { name: 'Product Name' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Product Name' }),
    'Updated'
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Updated (basic)')).toBeVisible()
  await user.click(
    screen.getByRole('button', { name: 'Delete CatFK product Updated' })
  )
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete',
    })
  )
  expect(await screen.findByText('No CatFK products configured')).toBeVisible()
})

test('reading channels posts only the store token and selections survive a settings reload', async () => {
  const channel = { id: 'qr', name: 'QR channel', icon: '' }
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: [channel] },
  })
  const user = userEvent.setup()
  const onChange = vi.fn()
  const view = render(
    <CatFKSettingsFields
      values={defaults}
      complianceConfirmed
      onChange={onChange}
    />,
    { wrapper: Wrapper }
  )
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Read CatFK channels' }))
  const checkbox = await screen.findByRole('checkbox', { name: 'QR channel' })
  await user.click(checkbox)
  expect(api.post).toHaveBeenCalledWith('/api/option/catfk/channels', {
    store_token: '',
  })
  expect(onChange).toHaveBeenCalledWith(
    'CatFKChannels',
    JSON.stringify([channel])
  )
  view.unmount()
  render(<Fixture initial={{ CatFKChannels: JSON.stringify([channel]) }} />, {
    wrapper: Wrapper,
  })
  expect(screen.getByRole('checkbox', { name: 'QR channel' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'QR channel' })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
})

test('an old channel response cannot populate channels after an external token reset', async () => {
  let resolvePending!: (value: {
    data: {
      success: boolean
      data: { id: string; name: string; icon: string }[]
    }
  }) => void
  const pending = new Promise<{
    data: {
      success: boolean
      data: { id: string; name: string; icon: string }[]
    }
  }>((resolve) => {
    resolvePending = resolve
  })
  vi.spyOn(api, 'post').mockReturnValue(pending)
  const user = userEvent.setup()
  const view = render(
    <CatFKSettingsFields
      values={{ ...defaults, CatFKStoreToken: 'old' }}
      complianceConfirmed
      onChange={() => undefined}
    />,
    { wrapper: Wrapper }
  )
  await user.click(screen.getByRole('button', { name: 'Read CatFK channels' }))
  expect(screen.getByRole('button', { name: 'Loading...' })).toBeDisabled()
  view.rerender(
    <CatFKSettingsFields
      values={{ ...defaults, CatFKStoreToken: 'new' }}
      complianceConfirmed
      onChange={() => undefined}
    />
  )
  await act(async () =>
    resolvePending({
      data: {
        success: true,
        data: [{ id: 'old', name: 'Old channel', icon: '' }],
      },
    })
  )
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Read CatFK channels' })
    ).toBeEnabled()
  )
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
})

test('a protocol failure is displayed without inventing available channels', async () => {
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: false, message: 'CatFK protocol is not verified' },
  })
  const notice = vi.spyOn(toast, 'error').mockImplementation(() => 'test')
  const user = userEvent.setup()
  render(<Fixture />, { wrapper: Wrapper })
  await user.click(screen.getByRole('button', { name: 'Read CatFK channels' }))
  await waitFor(() =>
    expect(notice).toHaveBeenCalledWith('CatFK protocol is not verified')
  )
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(
    screen.queryByText(/provider protocol has not been verified/)
  ).not.toBeInTheDocument()
})

test('invalid persisted mappings block edits and an unconfirmed account cannot enable CatFK', () => {
  render(
    <CatFKSettingsFields
      values={{ ...defaults, CatFKProducts: 'null' }}
      complianceConfirmed={false}
      onChange={() => undefined}
    />,
    { wrapper: Wrapper }
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Invalid CatFK mapping configuration'
  )
  expect(screen.getByRole('button', { name: 'Add product' })).toBeDisabled()
  expect(screen.getByRole('switch', { name: 'Enable CatFK' })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
})
