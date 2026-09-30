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
import type { UpstreamCostInfo } from '../data/schema'
import type { UpstreamCostStatistics } from '../types'

export const UPSTREAM_COST_STATUS = {
  UNKNOWN: 0,
  ESTIMATED: 1,
  MATCHED: 2,
} as const

/** A log's upstream cost is usable once it is matched or estimated. */
export function hasKnownUpstreamCost(
  cost: UpstreamCostInfo | null | undefined
): cost is UpstreamCostInfo {
  return (
    cost?.status === UPSTREAM_COST_STATUS.ESTIMATED ||
    cost?.status === UPSTREAM_COST_STATUS.MATCHED
  )
}

/** Our charge minus the upstream cost; null while the cost is unknown. */
export function getLogProfit(
  quota: number,
  cost: UpstreamCostInfo | null | undefined
): number | null {
  if (!hasKnownUpstreamCost(cost)) return null
  return quota - cost.cost_quota
}

/** Text color of a profit value; break-even stays neutral. */
export function getProfitClassName(profit: number): string | undefined {
  if (profit > 0) return 'text-success'
  if (profit < 0) return 'text-destructive'
  return undefined
}

export type UpstreamCostSummary = {
  profit: number
  /** Profit ÷ revenue; null without revenue. */
  grossMargin: number | null
  /** Revenue ÷ total usage, capped to [0, 1]; null without usage. */
  coverage: number | null
  /** Consume logs considered by the backend, including unknown costs. */
  recordCount: number
}

/**
 * Derives the admin stat badges. Revenue only covers logs with a known cost,
 * so coverage shows how much of the total usage the profit figures describe.
 */
export function summarizeUpstreamCost(
  stats: UpstreamCostStatistics,
  totalQuota: number
): UpstreamCostSummary {
  const profit = stats.revenue - stats.cost
  return {
    profit,
    grossMargin: stats.revenue > 0 ? profit / stats.revenue : null,
    coverage:
      totalQuota > 0
        ? Math.min(Math.max(stats.revenue / totalQuota, 0), 1)
        : null,
    recordCount: stats.matched + stats.estimated + stats.unknown,
  }
}
