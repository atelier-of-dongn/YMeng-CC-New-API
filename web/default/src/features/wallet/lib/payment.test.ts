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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  getTopupPromptContent,
  getTopupPromptVisibility,
  parsePaymentMethodText,
  parsePaymentMethodDisplayFlag,
  parseTopupLinkImage,
} from './payment-display.ts'

const paymentMethod = {}

describe('payment confirmation top-up prompt visibility', () => {
  test('preserves the legacy enabled default for missing display flags', () => {
    assert.equal(parsePaymentMethodDisplayFlag(undefined), true)
    assert.deepEqual(
      getTopupPromptVisibility(paymentMethod, 'https://example.com/topup'),
      { showNotice: true, showLink: true }
    )
  })

  test('parses string and boolean display flags', () => {
    assert.equal(parsePaymentMethodDisplayFlag('false'), false)
    assert.equal(parsePaymentMethodDisplayFlag(' TRUE '), true)
    assert.equal(parsePaymentMethodDisplayFlag(false), false)
  })

  test('normalizes custom notice text and HTTPS images', () => {
    assert.equal(parsePaymentMethodText('  Custom notice  '), 'Custom notice')
    assert.equal(parsePaymentMethodText('   '), undefined)
    assert.equal(
      parseTopupLinkImage(' https://example.com/topup.png '),
      'https://example.com/topup.png'
    )
    assert.equal(parseTopupLinkImage('http://example.com/topup.png'), undefined)
    assert.equal(parseTopupLinkImage('not-a-url'), undefined)
  })

  test('uses custom prompt content and leaves missing content empty', () => {
    assert.deepEqual(
      getTopupPromptContent({
        topup_notice_text: 'USDT confirmation may take a few minutes.',
        topup_link_image: 'https://example.com/usdt.png',
      }),
      {
        noticeText: 'USDT confirmation may take a few minutes.',
        linkImage: 'https://example.com/usdt.png',
      }
    )
    assert.deepEqual(getTopupPromptContent({}), {
      noticeText: undefined,
      linkImage: undefined,
    })
    assert.equal(
      getTopupPromptContent({
        topup_link_image: 'http://example.com/insecure.png',
      }).linkImage,
      undefined
    )
  })

  test('supports all notice and link flag combinations', () => {
    const topupLink = 'https://example.com/topup'
    const cases = [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ] as const

    for (const [showNotice, showLink] of cases) {
      assert.deepEqual(
        getTopupPromptVisibility(
          {
            ...paymentMethod,
            show_topup_notice: showNotice,
            show_topup_link: showLink,
          },
          topupLink
        ),
        { showNotice, showLink }
      )
    }
  })

  test('hides both elements when the global top-up link is empty', () => {
    assert.deepEqual(
      getTopupPromptVisibility(
        {
          ...paymentMethod,
          show_topup_notice: true,
          show_topup_link: true,
        },
        ''
      ),
      { showNotice: false, showLink: false }
    )
  })
})
