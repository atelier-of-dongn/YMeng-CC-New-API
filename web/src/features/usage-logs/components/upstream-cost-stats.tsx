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
import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { Percent, PieChart } from 'lucide-react'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatLogQuota, formatPercent } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getUpstreamCostStats } from '../api'
import { summarizeUpstreamCost } from '../lib/upstream-cost'
import { buildApiParams } from '../lib/utils'
import { StatBadge } from './stat-badge'
import { useUsageLogsContext } from './usage-logs-provider'

const route = getRouteApi('/_authenticated/usage-logs/$section')

const SENSITIVE_MASK = '••••'
const STATS_STALE_TIME_MS = 15_000

type UpstreamCostStatsProps = {
  /**
   * Total usage (`quota`) of the regular log stats for the same filters. Used
   * only for the coverage ratio; the upstream request itself does not depend
   * on it, so the two queries can run in parallel.
   */
  totalQuota?: number
  /** Lay out the badges in a two-column grid for narrow screens. */
  compact?: boolean
}

/** Admin-only revenue/cost/profit badges for the filtered consume logs. */
export function UpstreamCostStats(props: UpstreamCostStatsProps) {
  const { t } = useTranslation()
  const searchParams = route.useSearch()
  const { sensitiveVisible, internalAccounting } = useUsageLogsContext()

  // The cost ledger has no token id or client IP, so those two filters cannot
  // narrow these totals; hide them rather than show an unrelated number.
  const unsupportedFilter = Boolean(searchParams.tokenId || searchParams.ip)

  // The key must start with 'usage-logs-stats' so the filter bar refreshes it.
  const { data: stats, isLoading, isError } = useQuery({
    queryKey: [
      'usage-logs-stats',
      'upstream-cost',
      searchParams,
      internalAccounting,
    ],
    enabled: !unsupportedFilter,
    staleTime: STATS_STALE_TIME_MS,
    queryFn: async () => {
      const params = {
        ...buildApiParams({
          page: 1,
          pageSize: 1,
          searchParams,
          columnFilters: [],
          isAdmin: true,
        }),
        internal_accounting: internalAccounting,
      }
      return (
        requireServerSuccess(await getUpstreamCostStats(params)).data ?? null
      )
    },
    placeholderData: (previousData) => previousData,
    // Supplementary to the regular stats: a failure only hides this group.
    meta: { errorToast: false },
  })

  const Wrapper = props.compact ? 'div' : Fragment
  const wrapperProps = props.compact
    ? { className: 'col-span-2 grid grid-cols-2 gap-1.5' }
    : {}

  if (unsupportedFilter) {
    return null
  }

  if (isLoading && !stats) {
    return (
      <Wrapper {...wrapperProps}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton
            key={i}
            className={props.compact ? 'h-7 w-full rounded-md' : 'h-7 w-28 rounded-md'}
          />
        ))}
      </Wrapper>
    )
  }

  if (!stats || isError) {
    return null
  }
  const summary = summarizeUpstreamCost(stats, props.totalQuota ?? 0)
  if (summary.recordCount === 0) {
    return null
  }

  const formatMoney = (quota: number) =>
    sensitiveVisible ? formatLogQuota(quota) : SENSITIVE_MASK
  const formatShare = (value: number | null) =>
    value === null ? '-' : formatPercent(value * 100)

  return (
    <Wrapper {...wrapperProps}>
      <StatBadge
        label={t('Revenue')}
        value={formatMoney(stats.revenue)}
        accent='bg-chart-2/70'
        monetary
      />
      <StatBadge
        label={t('Upstream Cost')}
        value={formatMoney(stats.cost)}
        accent='bg-warning/70'
        monetary
      />
      <StatBadge
        label={t('Affiliate Rebate')}
        value={formatMoney(stats.affiliate_cost)}
        accent='bg-muted-foreground/70'
        monetary
      />
      <StatBadge
        label={t('Profit')}
        value={formatMoney(summary.profit)}
        accent={summary.profit < 0 ? 'bg-destructive/70' : 'bg-success/70'}
        monetary
      />
      <StatBadge
        label={t('Gross Margin')}
        value={formatShare(summary.grossMargin)}
        accent='bg-chart-4/70'
        icon={<Percent />}
      />
      <div className={props.compact ? 'col-span-2' : undefined}>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type='button'
                className='focus-visible:ring-ring/50 w-full cursor-help rounded-md outline-none focus-visible:ring-2'
              />
            }
          >
            <StatBadge
              label={t('Coverage')}
              value={formatShare(summary.coverage)}
              accent='bg-info/70'
              icon={<PieChart />}
            />
          </TooltipTrigger>
          <TooltipContent>
            <div className='space-y-1'>
              <p>{t('Share of total usage with a known upstream cost')}</p>
              <p>
                {t(
                  'Profit deducts upstream cost and affiliate rebates for usage with a known upstream cost only'
                )}
              </p>
              <p>{t('Matched: {{count}}', { count: stats.matched })}</p>
              <p>{t('Estimated: {{count}}', { count: stats.estimated })}</p>
              <p>{t('Unknown cost: {{count}}', { count: stats.unknown })}</p>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    </Wrapper>
  )
}
