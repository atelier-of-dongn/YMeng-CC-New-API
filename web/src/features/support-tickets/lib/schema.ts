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
import { z } from 'zod'

import {
  MAX_MARKDOWN_FILE_SIZE,
  MAX_TICKET_CONTENT_LENGTH,
  MAX_TICKET_REQUEST_ID_LENGTH,
} from '../constants'

export const createSupportTicketSchema = z
  .object({
    content: z.string().max(MAX_TICKET_CONTENT_LENGTH),
    requestId: z.string().max(MAX_TICKET_REQUEST_ID_LENGTH),
    file: z.instanceof(File).nullable(),
  })
  .superRefine((values, context) => {
    if (
      values.content.trim() ||
      values.requestId.trim() ||
      values.file !== null
    ) {
      if (values.file) validateMarkdownFile(values.file, context)
      return
    }
    context.addIssue({
      code: 'custom',
      message: 'Provide feedback, a request ID, or a Markdown file.',
      path: ['content'],
    })
  })

export const replySupportTicketSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Enter a reply.')
    .max(MAX_TICKET_CONTENT_LENGTH),
})

export type CreateSupportTicketValues = z.infer<
  typeof createSupportTicketSchema
>
export type ReplySupportTicketValues = z.infer<typeof replySupportTicketSchema>

export function getMarkdownFileError(file: File): string | null {
  if (!/\.(?:md|markdown)$/i.test(file.name)) {
    return 'Select a .md or .markdown file.'
  }
  if (file.size === 0) return 'The Markdown file is empty.'
  if (file.size > MAX_MARKDOWN_FILE_SIZE) {
    return 'The Markdown file must be 1 MiB or smaller.'
  }
  return null
}

export function validateMarkdownFile(
  file: File,
  context: z.RefinementCtx
): void {
  const error = getMarkdownFileError(file)
  if (error) {
    context.addIssue({ code: 'custom', message: error, path: ['file'] })
  }
}

export async function readMarkdownFile(file: File): Promise<string> {
  const text = await file.text()
  if (text.includes('\0')) {
    throw new Error('The Markdown file contains NUL bytes.')
  }
  if (!text.trim()) throw new Error('The Markdown file is empty.')
  return text
}
