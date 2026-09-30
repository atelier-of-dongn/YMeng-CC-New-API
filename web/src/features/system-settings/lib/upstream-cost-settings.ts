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

import type { OperationsSettings } from '../types'

export type FlatUpstreamCostSettings = Pick<
  OperationsSettings,
  | 'upstream_cost_setting.enabled'
  | 'upstream_cost_setting.auto_detect'
  | 'upstream_cost_setting.log_poll_seconds'
  | 'upstream_cost_setting.pricing_minutes'
  | 'upstream_cost_setting.ratio_change_hold_hours'
  | 'upstream_cost_setting.retention_days'
  | 'upstream_cost_setting.feishu_webhook_url'
  | 'upstream_cost_setting.feishu_secret'
>

export const UPSTREAM_COST_SETTING_DEFAULTS: FlatUpstreamCostSettings = {
  'upstream_cost_setting.enabled': false,
  'upstream_cost_setting.auto_detect': true,
  'upstream_cost_setting.log_poll_seconds': 60,
  'upstream_cost_setting.pricing_minutes': 5,
  'upstream_cost_setting.ratio_change_hold_hours': 24,
  'upstream_cost_setting.retention_days': 30,
  'upstream_cost_setting.feishu_webhook_url': '',
  'upstream_cost_setting.feishu_secret': '',
}

/** Write-only option: the backend never returns it, so it loads as ''. */
const FEISHU_SECRET_KEY = 'upstream_cost_setting.feishu_secret'

const FEISHU_WEBHOOK_PREFIXES = [
  'https://open.feishu.cn/',
  'https://open.larksuite.com/',
]

/** Empty keeps alerts off; otherwise only Feishu/Lark bot webhooks are allowed. */
export function isValidFeishuWebhookUrl(value: string): boolean {
  if (value === '') return true
  if (!FEISHU_WEBHOOK_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return false
  }
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

const WHOLE_NUMBER_MESSAGE = 'Enter a whole number'

export const upstreamCostSettingsSchema = z.object({
  upstream_cost_setting: z.object({
    enabled: z.boolean(),
    auto_detect: z.boolean(),
    log_poll_seconds: z.coerce
      .number()
      .int(WHOLE_NUMBER_MESSAGE)
      .min(30, 'Polling interval must be at least 30 seconds'),
    pricing_minutes: z.coerce
      .number()
      .int(WHOLE_NUMBER_MESSAGE)
      .min(1, 'Must be at least 1'),
    ratio_change_hold_hours: z.coerce
      .number()
      .int(WHOLE_NUMBER_MESSAGE)
      .min(1, 'Must be at least 1'),
    retention_days: z.coerce
      .number()
      .int(WHOLE_NUMBER_MESSAGE)
      .min(0, 'Must be 0 or greater'),
    feishu_webhook_url: z
      .string()
      .trim()
      .refine(
        isValidFeishuWebhookUrl,
        'Webhook URL must start with https://open.feishu.cn/ or https://open.larksuite.com/'
      ),
    feishu_secret: z.string(),
  }),
})

export type UpstreamCostSettingsFormInput = z.input<
  typeof upstreamCostSettingsSchema
>
export type UpstreamCostSettingsFormValues = z.output<
  typeof upstreamCostSettingsSchema
>

export function toUpstreamCostFormValues(
  settings: FlatUpstreamCostSettings
): UpstreamCostSettingsFormInput {
  return {
    upstream_cost_setting: {
      enabled: settings['upstream_cost_setting.enabled'],
      auto_detect: settings['upstream_cost_setting.auto_detect'],
      log_poll_seconds: settings['upstream_cost_setting.log_poll_seconds'],
      pricing_minutes: settings['upstream_cost_setting.pricing_minutes'],
      ratio_change_hold_hours:
        settings['upstream_cost_setting.ratio_change_hold_hours'],
      retention_days: settings['upstream_cost_setting.retention_days'],
      feishu_webhook_url: settings['upstream_cost_setting.feishu_webhook_url'],
      feishu_secret: settings['upstream_cost_setting.feishu_secret'],
    },
  }
}

export function toFlatUpstreamCostSettings(
  values: UpstreamCostSettingsFormValues
): FlatUpstreamCostSettings {
  const setting = values.upstream_cost_setting
  return {
    'upstream_cost_setting.enabled': setting.enabled,
    'upstream_cost_setting.auto_detect': setting.auto_detect,
    'upstream_cost_setting.log_poll_seconds': setting.log_poll_seconds,
    'upstream_cost_setting.pricing_minutes': setting.pricing_minutes,
    'upstream_cost_setting.ratio_change_hold_hours':
      setting.ratio_change_hold_hours,
    'upstream_cost_setting.retention_days': setting.retention_days,
    'upstream_cost_setting.feishu_webhook_url': setting.feishu_webhook_url,
    'upstream_cost_setting.feishu_secret': setting.feishu_secret,
  }
}

/**
 * Option keys to save, compared with the last saved baseline. An empty secret
 * means "keep the stored secret" and is never submitted.
 */
export function getChangedUpstreamCostSettings(
  next: FlatUpstreamCostSettings,
  baseline: FlatUpstreamCostSettings
): Array<keyof FlatUpstreamCostSettings> {
  return (Object.keys(next) as Array<keyof FlatUpstreamCostSettings>).filter(
    (key) => {
      if (key === FEISHU_SECRET_KEY && next[key] === '') return false
      return next[key] !== baseline[key]
    }
  )
}
