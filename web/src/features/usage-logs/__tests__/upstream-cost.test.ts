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

import { usageLogSchema, type UpstreamCostInfo } from '../data/schema'
import {
  UPSTREAM_COST_STATUS,
  getLogProfit,
  getProfitClassName,
  hasKnownUpstreamCost,
  summarizeUpstreamCost,
} from '../lib/upstream-cost'
import type { UpstreamCostStatistics } from '../types'

function upstreamCost(status: number, costQuota: number): UpstreamCostInfo {
  return {
    status,
    upstream_group: 'vip',
    upstream_group_ratio: 1.5,
    upstream_quota: 3000,
    cost_quota: costQuota,
    internal_use: false,
  }
}

function stats(
  overrides: Partial<UpstreamCostStatistics>
): UpstreamCostStatistics {
  return {
    revenue: 0,
    cost: 0,
    covered_quota: 0,
    internal_cost: 0,
    internal_estimated_cost: 0,
    matched: 0,
    estimated: 0,
    unknown: 0,
    internal_unknown: 0,
    ...overrides,
  }
}

describe('usage log upstream cost field', () => {
  test('parses logs without the admin-only upstream cost field', () => {
    const log = usageLogSchema.parse({
      id: 1,
      user_id: 1,
      created_at: 1,
      type: 2,
      content: '',
    })

    expect(log.upstream_cost).toBeUndefined()
  })

  test('parses an upstream cost record attached to an admin log item', () => {
    const log = usageLogSchema.parse({
      id: 1,
      user_id: 1,
      created_at: 1,
      type: 2,
      content: '',
      upstream_cost: { status: 2, upstream_group: 'vip', cost_quota: 800 },
    })

    expect(log.upstream_cost).toEqual({
      status: 2,
      upstream_group: 'vip',
      upstream_group_ratio: 0,
      upstream_quota: 0,
      cost_quota: 800,
      internal_use: false,
    })
  })
})

describe('log profit', () => {
  test('treats matched and estimated costs as known, unknown or missing as unknown', () => {
    expect(
      hasKnownUpstreamCost(upstreamCost(UPSTREAM_COST_STATUS.MATCHED, 1))
    ).toBe(true)
    expect(
      hasKnownUpstreamCost(upstreamCost(UPSTREAM_COST_STATUS.ESTIMATED, 1))
    ).toBe(true)
    expect(
      hasKnownUpstreamCost(upstreamCost(UPSTREAM_COST_STATUS.UNKNOWN, 1))
    ).toBe(false)
    expect(hasKnownUpstreamCost(null)).toBe(false)
    expect(hasKnownUpstreamCost(undefined)).toBe(false)
  })

  test('subtracts the upstream cost from the charged quota when the cost is known', () => {
    expect(
      getLogProfit(1000, upstreamCost(UPSTREAM_COST_STATUS.MATCHED, 800))
    ).toBe(200)
    expect(
      getLogProfit(1000, upstreamCost(UPSTREAM_COST_STATUS.ESTIMATED, 1250))
    ).toBe(-250)
  })

  test('treats internal usage as cost-only when internal accounting is enabled', () => {
    const cost = {
      ...upstreamCost(UPSTREAM_COST_STATUS.MATCHED, 800),
      internal_use: true,
    }

    expect(getLogProfit(1000, cost, true)).toBe(-800)
    expect(getLogProfit(1000, cost, false)).toBe(200)
  })

  test('returns no profit while the upstream cost is unknown or absent', () => {
    expect(
      getLogProfit(1000, upstreamCost(UPSTREAM_COST_STATUS.UNKNOWN, 0))
    ).toBeNull()
    expect(getLogProfit(1000, undefined)).toBeNull()
  })

  test('colors gains as success, losses as destructive, and break-even neutrally', () => {
    expect(getProfitClassName(1)).toBe('text-success')
    expect(getProfitClassName(-1)).toBe('text-destructive')
    expect(getProfitClassName(0)).toBeUndefined()
  })
})

describe('upstream cost summary', () => {
  test('derives profit, gross margin, and coverage of the total usage', () => {
    const summary = summarizeUpstreamCost(
      stats({ revenue: 800, cost: 600, matched: 3, estimated: 1, unknown: 2 }),
      1000
    )

    expect(summary).toEqual({
      profit: 200,
      grossMargin: 0.25,
      coverage: 0.8,
      recordCount: 6,
    })
  })

  test('reports no gross margin instead of dividing by zero revenue', () => {
    const summary = summarizeUpstreamCost(
      stats({ revenue: 0, cost: 120, unknown: 4 }),
      500
    )

    expect(summary.grossMargin).toBeNull()
    expect(summary.profit).toBe(-120)
    expect(summary.coverage).toBe(0)
  })

  test('reports no coverage instead of dividing by zero total usage', () => {
    const summary = summarizeUpstreamCost(
      stats({ revenue: 300, cost: 100, matched: 1 }),
      0
    )

    expect(summary.coverage).toBeNull()
    expect(summary.grossMargin).toBeCloseTo(2 / 3)
  })

  test('caps coverage at 100% when revenue exceeds the separately queried total', () => {
    const summary = summarizeUpstreamCost(
      stats({ revenue: 1200, cost: 100, matched: 2 }),
      1000
    )

    expect(summary.coverage).toBe(1)
  })

  test('counts no records when the backend found no consume logs', () => {
    expect(summarizeUpstreamCost(stats({}), 1000).recordCount).toBe(0)
  })
})

test('request cost logs retain their own strategy and fixed amount for profit', () => {
  const log = usageLogSchema.parse({
    id: 1,
    user_id: 2,
    created_at: 1,
    type: 2,
    content: '',
    quota: 2000,
    upstream_cost: { status: 1, cost_mode: 'request', cost_quota: 500 },
  })
  expect(log.upstream_cost?.cost_mode).toBe('request')
  expect(getLogProfit(log.quota, log.upstream_cost)).toBe(1500)
})
