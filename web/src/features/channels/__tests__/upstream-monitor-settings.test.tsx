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
