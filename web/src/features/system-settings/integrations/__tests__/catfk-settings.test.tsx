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
  const pending = Promise.withResolvers<{
    data: {
      success: boolean
      data: { id: string; name: string; icon: string }[]
    }
  }>()
  vi.spyOn(api, 'post').mockReturnValue(pending.promise)
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
    pending.resolve({
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
  expect(screen.getByRole('status')).toHaveTextContent('CatFK is not connected')
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
