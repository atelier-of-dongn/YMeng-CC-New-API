/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { InvoiceSearchBar } from '../components/invoice-search-bar'

describe('InvoiceSearchBar', () => {
  test('submitting a keyword searches the selected column', () => {
    const onSearch = vi.fn()
    render(<InvoiceSearchBar field='username' keyword='' onSearch={onSearch} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Search column' }), {
      target: { value: 'trade_no' },
    })
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search keyword' }),
      {
        target: { value: ' T-100 ' },
      }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(onSearch).toHaveBeenCalledWith('trade_no', 'T-100')
  })

  test('invalid amount is flagged and not searched', () => {
    const onSearch = vi.fn()
    render(
      <InvoiceSearchBar field='net_amount' keyword='' onSearch={onSearch} />
    )
    const input = screen.getByRole('searchbox', { name: 'Search keyword' })

    fireEvent.change(input, { target: { value: '12.3456789' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(onSearch).not.toHaveBeenCalled()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(
      'Enter an amount with up to 6 decimal places'
    )
  })
})
