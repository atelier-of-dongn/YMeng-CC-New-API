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

import { parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'

import { DEFAULT_GROUP } from '../constants'
import type { ApiKey, ApiKeyFormData, ApiKeyRoutingMode } from '../types'

// ============================================================================
// Form Schema
// ============================================================================

export function getApiKeyFormSchema(t: TFunction) {
  return z
    .object({
      name: z.string().min(1, t('Please enter a name')),
      remain_quota_dollars: z.number().optional(),
      expired_time: z.date().optional(),
      unlimited_quota: z.boolean(),
      model_limits: z.array(z.string()),
      allow_ips: z.string().optional(),
      routing_mode: z.enum(['single', 'multi']),
      group: z.string(),
      groups: z.array(z.string()),
      tokenCount: z.number().min(1).optional(),
    })
    .superRefine((data, ctx) => {
      if (data.routing_mode === 'single' && !data.group) {
        ctx.addIssue({
          code: 'custom',
          path: ['group'],
          message: t('Select a group'),
        })
      }
      if (data.routing_mode === 'multi' && data.groups.length < 2) {
        ctx.addIssue({
          code: 'custom',
          path: ['groups'],
          message: t('Select at least two groups'),
        })
      }
      if (data.unlimited_quota) {
        return
      }

      if (
        data.remain_quota_dollars === undefined ||
        data.remain_quota_dollars < 0
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['remain_quota_dollars'],
          message: t('Quota must be zero or greater'),
        })
      }
    })
}

export type ApiKeyFormValues = z.infer<ReturnType<typeof getApiKeyFormSchema>>

// ============================================================================
// Form Defaults
// ============================================================================

export const API_KEY_FORM_DEFAULT_VALUES: ApiKeyFormValues = {
  name: '',
  remain_quota_dollars: 10,
  expired_time: undefined,
  unlimited_quota: true,
  model_limits: [],
  allow_ips: '',
  routing_mode: 'single',
  group: DEFAULT_GROUP,
  groups: [],
  tokenCount: 1,
}

export function getApiKeyFormDefaultValues(): ApiKeyFormValues {
  return {
    ...API_KEY_FORM_DEFAULT_VALUES,
    routing_mode: 'single',
    group: DEFAULT_GROUP,
    groups: [],
  }
}

// ============================================================================
// Form Data Transformation
// ============================================================================

/**
 * Transform form data to API payload
 */
export function transformFormDataToPayload(
  data: ApiKeyFormValues
): ApiKeyFormData {
  const isMulti = data.routing_mode === 'multi'
  const group = isMulti ? data.groups[0] || '' : data.group

  return {
    name: data.name,
    remain_quota: data.unlimited_quota
      ? 0
      : parseQuotaFromDollars(data.remain_quota_dollars || 0),
    expired_time: data.expired_time
      ? Math.floor(data.expired_time.getTime() / 1000)
      : -1,
    unlimited_quota: data.unlimited_quota,
    model_limits_enabled: data.model_limits.length > 0,
    model_limits: data.model_limits.join(','),
    allow_ips: data.allow_ips || '',
    group,
    groups: isMulti ? data.groups : [],
    cross_group_retry: isMulti,
  }
}

/**
 * Transform API key data to form defaults
 */
export function transformApiKeyToFormDefaults(
  apiKey: ApiKey
): ApiKeyFormValues {
  let routingMode: ApiKeyRoutingMode = 'single'
  let group = apiKey.group || ''
  let groups: string[] = []
  if (apiKey.groups.length >= 2) {
    routingMode = 'multi'
    groups = apiKey.groups
    group = apiKey.groups[0]
  } else if (apiKey.groups.length === 1) {
    group = apiKey.groups[0]
  }
  if (group === 'auto') {
    group = ''
  }

  return {
    name: apiKey.name,
    remain_quota_dollars: apiKey.unlimited_quota
      ? 0
      : quotaUnitsToDollars(apiKey.remain_quota),
    expired_time:
      apiKey.expired_time > 0
        ? new Date(apiKey.expired_time * 1000)
        : undefined,
    unlimited_quota: apiKey.unlimited_quota,
    model_limits: apiKey.model_limits
      ? apiKey.model_limits.split(',').filter(Boolean)
      : [],
    allow_ips: apiKey.allow_ips || '',
    routing_mode: routingMode,
    group,
    groups,
    tokenCount: 1,
  }
}
