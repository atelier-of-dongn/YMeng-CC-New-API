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
import type { TFunction } from 'i18next'
import { z } from 'zod'

export function getInvoiceFormSchema(t: TFunction) {
  return z.object({
    title: z
      .string()
      .trim()
      .min(1, t('Invoice title is required'))
      .max(200, t('Invoice title must be 200 characters or fewer')),
    taxId: z
      .string()
      .trim()
      .min(1, t('Tax identifier is required'))
      .max(64, t('Tax identifier must be 64 characters or fewer')),
  })
}

export type InvoiceFormValues = z.infer<ReturnType<typeof getInvoiceFormSchema>>

export function getInvoiceRejectSchema(t: TFunction) {
  return z.object({
    reason: z
      .string()
      .trim()
      .min(1, t('Rejection reason is required'))
      .refine(
        (value) => [...value].length <= 500,
        t('Rejection reason must be 500 characters or fewer')
      ),
  })
}

export type InvoiceRejectValues = z.infer<
  ReturnType<typeof getInvoiceRejectSchema>
>
