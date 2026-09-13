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
import { isHttpsUrl } from '../../../lib/content-format.ts'

type PaymentMethodDisplayOptions = {
  show_topup_notice?: boolean
  show_topup_link?: boolean
  topup_notice_text?: string
  topup_link_image?: string
}

/**
 * Parse an optional payment-method display flag. Missing values preserve the
 * legacy enabled behavior, while both JSON booleans and string values are
 * accepted defensively.
 */
export function parsePaymentMethodDisplayFlag(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    return value.trim().toLowerCase() !== 'false'
  }
  return true
}

export function parsePaymentMethodText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  return value.trim() || undefined
}

export function parseTopupLinkImage(value: unknown): string | undefined {
  const imageUrl = parsePaymentMethodText(value)
  return imageUrl && isHttpsUrl(imageUrl) ? imageUrl : undefined
}

export function getTopupPromptContent(
  paymentMethod: PaymentMethodDisplayOptions | undefined
): { noticeText: string | undefined; linkImage: string | undefined } {
  return {
    noticeText: parsePaymentMethodText(paymentMethod?.topup_notice_text),
    linkImage: parseTopupLinkImage(paymentMethod?.topup_link_image),
  }
}

/**
 * Resolve which optional elements appear in the payment confirmation dialog.
 */
export function getTopupPromptVisibility(
  paymentMethod: PaymentMethodDisplayOptions | undefined,
  topupLink: string | undefined
): { showNotice: boolean; showLink: boolean } {
  if (!topupLink) {
    return { showNotice: false, showLink: false }
  }

  return {
    showNotice: paymentMethod?.show_topup_notice !== false,
    showLink: paymentMethod?.show_topup_link !== false,
  }
}
