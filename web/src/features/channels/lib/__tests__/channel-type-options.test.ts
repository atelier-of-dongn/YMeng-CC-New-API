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
  CHANNEL_TYPE_OPTIONS,
  CHANNEL_TYPE_TASK_PLUGIN,
  CHANNEL_TYPES,
  MODEL_FETCHABLE_TYPES,
  FIELD_PASSTHROUGH_TYPES,
  OPENAI_FIELD_PASSTHROUGH_TYPES,
  CLAUDE_FIELD_PASSTHROUGH_TYPES,
  channelTypeOptionsForTaskPluginBind,
} from '../../constants'

describe('channel type compatibility', () => {
  test('keeps legacy JiaSu out of creation and gives gateways and inference servers distinct ids', () => {
    expect(
      CHANNEL_TYPE_OPTIONS.filter((option) =>
        [59, 62, 63, 64].includes(option.value)
      )
    ).toEqual(
      expect.arrayContaining([
        { value: 62, label: 'Sub2API' },
        { value: 63, label: 'vLLM' },
        { value: 64, label: 'SGLang' },
      ])
    )
    expect(CHANNEL_TYPE_OPTIONS.some((option) => option.value === 59)).toBe(
      false
    )
    expect(CHANNEL_TYPES[59]).toBe('JiaSu')
    for (const capabilities of [
      MODEL_FETCHABLE_TYPES,
      FIELD_PASSTHROUGH_TYPES,
      OPENAI_FIELD_PASSTHROUGH_TYPES,
      CLAUDE_FIELD_PASSTHROUGH_TYPES,
    ]) {
      expect(capabilities.has(59)).toBe(false)
      expect(capabilities.has(62)).toBe(true)
    }
  })
})

describe('channel type options for task plugin bind', () => {
  test('hides the task plugin type when the caller cannot bind', () => {
    const options = channelTypeOptionsForTaskPluginBind(false)

    expect(
      options.some((option) => option.value === CHANNEL_TYPE_TASK_PLUGIN)
    ).toBe(false)
  })

  test('shows the task plugin type when the caller can bind', () => {
    const options = channelTypeOptionsForTaskPluginBind(true)

    expect(options).toEqual(CHANNEL_TYPE_OPTIONS)
    expect(
      options.some((option) => option.value === CHANNEL_TYPE_TASK_PLUGIN)
    ).toBe(true)
  })
})
