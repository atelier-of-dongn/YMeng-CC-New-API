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
import { describe, expect, it } from 'vitest'

import { MAX_MARKDOWN_FILE_SIZE } from '../constants'
import {
  createSupportTicketSchema,
  readMarkdownFile,
  replySupportTicketSchema,
} from '../lib/schema'

describe('support ticket validation', () => {
  it.each([
    { content: 'A problem occurred', requestId: '', file: null },
    { content: '', requestId: 'req-123', file: null },
    {
      content: '',
      requestId: '',
      file: new File(['# Details'], 'details.md', { type: 'text/markdown' }),
    },
  ])('accepts any single source of ticket information: %j', (values) => {
    const result = createSupportTicketSchema.safeParse(values)
    expect(result.success).toBe(true)
  })

  it('rejects an empty ticket even when all fields contain whitespace', () => {
    const result = createSupportTicketSchema.safeParse({
      content: '  ',
      requestId: ' ',
      file: null,
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-Markdown, empty, and oversized attachments', () => {
    const files = [
      new File(['text'], 'notes.txt'),
      new File([], 'empty.md'),
      new File([new Uint8Array(MAX_MARKDOWN_FILE_SIZE + 1)], 'large.markdown'),
    ]
    for (const file of files) {
      expect(
        createSupportTicketSchema.safeParse({
          content: '',
          requestId: '',
          file,
        }).success
      ).toBe(false)
    }
  })

  it('rejects Markdown containing NUL bytes', async () => {
    await expect(
      readMarkdownFile(new File(['before\0after'], 'notes.md'))
    ).rejects.toThrow('NUL')
  })

  it('requires non-whitespace reply content', () => {
    expect(replySupportTicketSchema.safeParse({ content: '  ' }).success).toBe(
      false
    )
  })
})
