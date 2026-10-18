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
import { describe, expect, test } from 'vitest'

import { InvoicePDFUnavailableError, ensureInvoicePDFBlob } from '../lib/pdf'

describe('invoice PDF response validation', () => {
  test('PDF bytes are returned typed as application/pdf', async () => {
    const blob = await ensureInvoicePDFBlob(
      new Blob(['%PDF-1.7\n%%EOF'], { type: 'application/octet-stream' })
    )

    expect(blob.type).toBe('application/pdf')
  })

  test('JSON business failure is rejected with the server message', async () => {
    const response = new Blob(
      [JSON.stringify({ success: false, message: 'invoice not found' })],
      { type: 'application/json' }
    )

    await expect(ensureInvoicePDFBlob(response)).rejects.toThrow(
      'invoice not found'
    )
  })

  test('non-PDF bytes without a message are rejected', async () => {
    await expect(
      ensureInvoicePDFBlob(new Blob(['<html></html>']))
    ).rejects.toBeInstanceOf(InvoicePDFUnavailableError)
  })
})
