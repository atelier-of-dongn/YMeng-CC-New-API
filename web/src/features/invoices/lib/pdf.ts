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

export class InvoicePDFUnavailableError extends Error {}

/**
 * The invoice file endpoint answers business failures with a JSON body, so a
 * Blob response is only a PDF when it starts with the PDF signature. Anything
 * else is surfaced as an error carrying the server message, if any.
 */
export async function ensureInvoicePDFBlob(blob: Blob): Promise<Blob> {
  const signature = await blob.slice(0, 5).text()
  if (signature === '%PDF-') {
    return blob.type === 'application/pdf'
      ? blob
      : new Blob([blob], { type: 'application/pdf' })
  }
  let message = ''
  try {
    const payload = JSON.parse(await blob.text()) as {
      message?: unknown
    }
    if (typeof payload.message === 'string') message = payload.message
  } catch {
    // Not JSON: fall back to the caller's generic message.
  }
  throw new InvoicePDFUnavailableError(message)
}

export function saveInvoicePDF(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
