import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import { UpstreamMonitorSettings } from '../components/dialogs/upstream-monitor-settings'
import type { UpdateUpstreamMonitorParams } from '../types'

test('switching to manual mode exposes the multiplier and preserves the selected value', async () => {
  const onChange = vi.fn()
  const values: UpdateUpstreamMonitorParams = {
    mode: 'auto',
    manual_group: '',
    manual_ratio: null,
  }
  const { rerender } = render(
    <UpstreamMonitorSettings values={values} groups={[]} onChange={onChange} />
  )

  await userEvent.click(
    screen.getByRole('combobox', { name: 'Monitoring mode' })
  )
  await userEvent.click(screen.getByRole('option', { name: 'Manual' }))
  expect(onChange).toHaveBeenCalledWith({ ...values, mode: 'manual' })

  rerender(
    <UpstreamMonitorSettings
      values={{ ...values, mode: 'manual' }}
      groups={[]}
      onChange={onChange}
    />
  )
  const input = screen.getByRole('spinbutton', {
    name: 'Manual upstream multiplier',
  })
  fireEvent.change(input, { target: { value: '1.5' } })
  expect(onChange).toHaveBeenLastCalledWith({
    ...values,
    mode: 'manual',
    manual_ratio: 1.5,
  })
})

test('off mode hides automatic group and manual multiplier inputs', () => {
  render(
    <UpstreamMonitorSettings
      values={{ mode: 'off', manual_group: '', manual_ratio: null }}
      groups={[]}
      onChange={vi.fn()}
    />
  )
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('combobox', { name: 'Upstream Group' })
  ).not.toBeInTheDocument()
})

test('request mode preserves ratio settings and accepts an explicit zero price', async () => {
  const values: UpdateUpstreamMonitorParams = {
    mode: 'manual',
    manual_group: 'vip',
    manual_ratio: 1.5,
    cost_mode: 'ratio',
    request_price: null,
  }
  const onChange = vi.fn()
  const { rerender } = render(
    <UpstreamMonitorSettings values={values} groups={[]} onChange={onChange} />
  )
  await userEvent.click(
    screen.getByRole('combobox', { name: 'Cost calculation' })
  )
  await userEvent.click(screen.getByRole('option', { name: 'Per request' }))
  expect(onChange).toHaveBeenLastCalledWith({ ...values, cost_mode: 'request' })
  const requestValues = { ...values, cost_mode: 'request' as const }
  rerender(
    <UpstreamMonitorSettings
      values={requestValues}
      groups={[]}
      onChange={onChange}
    />
  )
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  const input = screen.getByRole('textbox', { name: 'Request price' })
  fireEvent.change(input, { target: { value: '0' } })
  expect(onChange).toHaveBeenLastCalledWith({
    ...requestValues,
    request_price: 0,
  })
  rerender(
    <UpstreamMonitorSettings
      values={{ ...requestValues, request_price: 0 }}
      groups={[]}
      onChange={onChange}
    />
  )
  fireEvent.change(screen.getByRole('textbox', { name: 'Request price' }), {
    target: { value: '' },
  })
  expect(onChange).toHaveBeenLastCalledWith({
    ...requestValues,
    request_price: null,
  })
})

test('negative request prices are invalid and pending controls are disabled', () => {
  render(
    <UpstreamMonitorSettings
      values={{
        mode: 'auto',
        manual_group: '',
        manual_ratio: null,
        cost_mode: 'request',
        request_price: -1,
      }}
      groups={[]}
      disabled
      onChange={vi.fn()}
    />
  )
  expect(
    screen.getByRole('textbox', { name: 'Request price' })
  ).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByRole('textbox', { name: 'Request price' })).toBeDisabled()
  expect(
    screen.getByRole('combobox', { name: 'Cost calculation' })
  ).toBeDisabled()
})
