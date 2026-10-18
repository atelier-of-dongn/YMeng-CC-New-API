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

import type { TFunction } from 'i18next'

import type { ApiKey } from '../types'
import {
  getApiKeyFormSchema,
  getApiKeyFormDefaultValues,
  transformApiKeyToFormDefaults,
  transformFormDataToPayload,
} from './api-key-form'

const apiKey: ApiKey = {
  id: 1,
  name: 'ordered',
  key: 'masked',
  status: 1,
  remain_quota: 0,
  used_quota: 0,
  unlimited_quota: true,
  expired_time: -1,
  created_time: 1,
  accessed_time: 1,
  group: 'premium',
  auto_groups: null,
  groups: ['premium', 'standard'],
  cross_group_retry: true,
  model_limits_enabled: false,
  model_limits: '',
  allow_ips: '',
  allow_user_quota_query: false,
}

describe('API key group routing form', () => {
  test('preserves multiple group order and forces cross-group retry', () => {
    const values = transformApiKeyToFormDefaults(apiKey)

    assert.equal(values.routing_mode, 'multi')
    assert.deepEqual(values.groups, ['premium', 'standard'])
    assert.deepEqual(transformFormDataToPayload(values).groups, [
      'premium',
      'standard',
    ])
    assert.equal(transformFormDataToPayload(values).group, 'premium')
    assert.equal(transformFormDataToPayload(values).cross_group_retry, true)
  })

  test('uses the original single-group payload shape', () => {
    const values = {
      ...getApiKeyFormDefaultValues(),
      group: 'standard',
    }
    const payload = transformFormDataToPayload(values)

    assert.equal(values.routing_mode, 'single')
    assert.equal(payload.group, 'standard')
    assert.deepEqual(payload.groups, [])
    assert.equal(payload.cross_group_retry, false)
  })

  test('normalizes one-element sequences to single group and rejects legacy Auto', () => {
    const oneGroup = transformApiKeyToFormDefaults({
      ...apiKey,
      group: 'premium',
      groups: ['premium'],
    })
    const legacyAuto = transformApiKeyToFormDefaults({
      ...apiKey,
      group: 'auto',
      groups: [],
    })

    assert.equal(oneGroup.routing_mode, 'single')
    assert.equal(oneGroup.group, 'premium')
    assert.deepEqual(oneGroup.groups, [])
    assert.equal(legacyAuto.routing_mode, 'single')
    assert.equal(legacyAuto.group, '')
  })

  test('requires at least two groups in multi-group mode', () => {
    const schema = getApiKeyFormSchema(((key: string) => key) as TFunction)
    const result = schema.safeParse({
      ...getApiKeyFormDefaultValues(),
      name: 'test',
      routing_mode: 'multi',
      group: '',
      groups: ['premium'],
    })

    assert.equal(result.success, false)
    assert.equal(
      result.error?.issues.find((issue) => issue.path[0] === 'groups')?.message,
      'Select at least two groups'
    )
  })
})
