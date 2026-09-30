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

import {
  UPSTREAM_COST_SETTING_DEFAULTS,
  getChangedUpstreamCostSettings,
  isValidFeishuWebhookUrl,
  toFlatUpstreamCostSettings,
  toUpstreamCostFormValues,
  upstreamCostSettingsSchema,
  type FlatUpstreamCostSettings,
} from '../lib/upstream-cost-settings'

function settings(
  overrides: Partial<FlatUpstreamCostSettings>
): FlatUpstreamCostSettings {
  return { ...UPSTREAM_COST_SETTING_DEFAULTS, ...overrides }
}

describe('Feishu webhook URL validation', () => {
  test.each([
    '',
    'https://open.feishu.cn/open-apis/bot/v2/hook/abc',
    'https://open.larksuite.com/open-apis/bot/v2/hook/abc',
  ])('accepts %j', (value) => {
    expect(isValidFeishuWebhookUrl(value)).toBe(true)
  })

  test.each([
    'http://open.feishu.cn/open-apis/bot/v2/hook/abc',
    'https://open.feishu.cn.example.com/hook',
    'https://user@open.feishu.cn/hook',
    'https://example.com/open.feishu.cn/hook',
    'https://open.feishu.cn',
  ])('rejects %j', (value) => {
    expect(isValidFeishuWebhookUrl(value)).toBe(false)
  })
})

describe('upstream cost settings form', () => {
  test('rejects a log polling interval below 30 seconds', () => {
    const values = toUpstreamCostFormValues(
      settings({ 'upstream_cost_setting.log_poll_seconds': 10 })
    )

    expect(upstreamCostSettingsSchema.safeParse(values).success).toBe(false)
  })

  test('trims the webhook URL before validating and saving it', () => {
    const values = toUpstreamCostFormValues(
      settings({
        'upstream_cost_setting.feishu_webhook_url':
          '  https://open.feishu.cn/open-apis/bot/v2/hook/abc  ',
      })
    )

    const parsed = upstreamCostSettingsSchema.parse(values)

    expect(
      toFlatUpstreamCostSettings(parsed)[
        'upstream_cost_setting.feishu_webhook_url'
      ]
    ).toBe('https://open.feishu.cn/open-apis/bot/v2/hook/abc')
  })
})

describe('changed upstream cost options', () => {
  test('never submits an empty write-only secret', () => {
    const baseline = settings({
      'upstream_cost_setting.feishu_secret': 'saved-before',
    })

    expect(getChangedUpstreamCostSettings(settings({}), baseline)).toEqual([])
  })

  test('submits a newly entered secret together with other changed keys', () => {
    const next = settings({
      'upstream_cost_setting.enabled': true,
      'upstream_cost_setting.feishu_secret': 'new-secret',
    })

    expect(getChangedUpstreamCostSettings(next, settings({}))).toEqual([
      'upstream_cost_setting.enabled',
      'upstream_cost_setting.feishu_secret',
    ])
  })

  test('submits a cleared webhook URL so alerts can be turned off', () => {
    const baseline = settings({
      'upstream_cost_setting.feishu_webhook_url':
        'https://open.feishu.cn/open-apis/bot/v2/hook/abc',
    })

    expect(getChangedUpstreamCostSettings(settings({}), baseline)).toEqual([
      'upstream_cost_setting.feishu_webhook_url',
    ])
  })
})
