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
  canSelectUpstreamGroup,
  formatUpstreamRatio,
  getSelectableUpstreamGroups,
  getUpstreamCostStatusDisplay,
  getUpstreamPricingStatusDisplay,
  getUpstreamSiteStatusDisplay,
  parseUpstreamCostFactor,
} from '../lib/upstream-cost'
import type { UpstreamGroupOption } from '../types'

function group(name: string, ratio: number): UpstreamGroupOption {
  return { name, ratio, public: true, offline: false, desc: '' }
}

describe('upstream cost status display', () => {
  test.each([
    ['normal', 'Normal', 'success'],
    ['ratio_changed', 'Ratio changed', 'warning'],
    ['inverted', 'Inverted', 'danger'],
    ['group_offline', 'Group offline', 'danger'],
    ['unknown', 'Unrecognized', 'neutral'],
    ['estimated', 'Estimated', 'warning'],
  ])(
    'maps the %s status to its label and badge variant',
    (status, label, variant) => {
      expect(getUpstreamCostStatusDisplay(status)).toEqual({ label, variant })
    }
  )

  test('falls back to the unrecognized state for values the UI does not know', () => {
    expect(getUpstreamCostStatusDisplay('degraded')).toEqual({
      label: 'Unrecognized',
      variant: 'neutral',
    })
    expect(getUpstreamCostStatusDisplay('constructor')).toEqual({
      label: 'Unrecognized',
      variant: 'neutral',
    })
  })
})

describe('upstream site and pricing status display', () => {
  test('shows a detected New API site as healthy and unknown sites as neutral', () => {
    expect(getUpstreamSiteStatusDisplay('newapi')).toEqual({
      label: 'New API',
      variant: 'success',
    })
    expect(getUpstreamSiteStatusDisplay('unreachable').variant).toBe('danger')
    expect(getUpstreamSiteStatusDisplay('mystery')).toEqual({
      label: 'Unknown',
      variant: 'neutral',
    })
  })

  test('hides the pricing badge until the pricing endpoint has been fetched', () => {
    expect(getUpstreamPricingStatusDisplay('')).toBeNull()
    expect(getUpstreamPricingStatusDisplay('groups_only')).toEqual({
      label: 'Groups only',
      variant: 'warning',
    })
  })
})

describe('upstream ratio formatting', () => {
  test.each([
    [1, '×1'],
    [1.5, '×1.5'],
    [0.123456, '×0.1235'],
    [0.00001234, '×0.000012'],
  ])('formats a known ratio %s as %s', (ratio, expected) => {
    expect(formatUpstreamRatio(ratio)).toBe(expected)
  })

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined])(
    'renders an unknown ratio %s as a dash',
    (ratio) => {
      expect(formatUpstreamRatio(ratio)).toBe('-')
    }
  )
})

describe('upstream group selection', () => {
  test('offers manual selection only when a New API site reports no group', () => {
    expect(
      canSelectUpstreamGroup({ effective_group: '', site_status: 'newapi' })
    ).toBe(true)
    expect(
      canSelectUpstreamGroup({ effective_group: 'vip', site_status: 'newapi' })
    ).toBe(false)
    expect(
      canSelectUpstreamGroup({ effective_group: '', site_status: 'pending' })
    ).toBe(false)
  })

  test('keeps a saved manual group selectable after the upstream stops listing it', () => {
    const groups = getSelectableUpstreamGroups({
      groups: [group('default', 1)],
      manual_group: 'retired',
    })

    expect(groups.map((item) => item.name)).toEqual(['default', 'retired'])
    expect(groups[1].ratio).toBe(0)
  })

  test('does not duplicate a manual group that is still listed upstream', () => {
    const groups = getSelectableUpstreamGroups({
      groups: [group('default', 1), group('vip', 1.5)],
      manual_group: 'vip',
    })

    expect(groups.map((item) => item.name)).toEqual(['default', 'vip'])
  })

  test('treats a missing candidate list from the backend as empty', () => {
    const groups = getSelectableUpstreamGroups({
      groups: null as unknown as UpstreamGroupOption[],
      manual_group: '',
    })

    expect(groups).toEqual([])
  })
})

describe('upstream cost factor validation', () => {
  test.each([
    ['1', 1],
    ['0.85', 0.85],
    [' 2.5 ', 2.5],
    ['100', 100],
  ])('accepts %s within the (0, 100] range', (raw, expected) => {
    expect(parseUpstreamCostFactor(raw)).toBe(expected)
  })

  test.each(['', '0', '-1', '100.01', 'abc'])(
    'rejects %j outside the (0, 100] range or not a number',
    (raw) => {
      expect(parseUpstreamCostFactor(raw)).toBeNull()
    }
  )
})
