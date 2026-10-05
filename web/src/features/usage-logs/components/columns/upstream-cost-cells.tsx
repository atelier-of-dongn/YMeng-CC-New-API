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
import { useTranslation } from 'react-i18next'

import { GroupBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatUpstreamRatio } from '@/features/channels/lib/upstream-cost'
import { formatLogQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { UsageLog } from '../../data/schema'
import {
  UPSTREAM_COST_STATUS,
  getLogProfit,
  getProfitClassName,
  hasKnownUpstreamCost,
} from '../../lib/upstream-cost'
import { useUsageLogsContext } from '../usage-logs-provider'

const SENSITIVE_MASK = '••••'

/** Logs without an upstream cost record (or with an unknown cost). */
function EmptyUpstreamCostCell() {
  return <span className='text-muted-foreground text-xs'>-</span>
}

/** Upstream group and ratio the request was billed at, e.g. `vip ×1.5`. */
export function UpstreamRatioLogCell(props: { log: UsageLog }) {
  const { sensitiveVisible } = useUsageLogsContext()
  const group = props.log.upstream_cost?.upstream_group ?? ''
  const ratio = props.log.upstream_cost?.upstream_group_ratio ?? 0

  if (!group && ratio <= 0) {
    return <EmptyUpstreamCostCell />
  }

  return (
    <span className='flex max-w-[160px] min-w-0 items-center gap-1 text-xs'>
      {group && (
        <GroupBadge
          group={group}
          label={sensitiveVisible ? undefined : SENSITIVE_MASK}
          type='text'
          size='sm'
          className='text-xs'
        />
      )}
      {ratio > 0 && (
        <span className='text-muted-foreground shrink-0 tabular-nums'>
          {formatUpstreamRatio(ratio)}
        </span>
      )}
    </span>
  )
}

/** Upstream cost in local quota units; the raw upstream quota is in the tooltip. */
export function UpstreamAmountLogCell(props: { log: UsageLog }) {
  const { t } = useTranslation()
  const cost = props.log.upstream_cost

  if (!hasKnownUpstreamCost(cost)) {
    return <EmptyUpstreamCostCell />
  }

  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className='inline-flex cursor-help items-center gap-1' />
          }
        >
          <span className='font-mono text-xs font-medium tabular-nums'>
            {formatLogQuota(cost.cost_quota)}
          </span>
          {cost.status === UPSTREAM_COST_STATUS.ESTIMATED && (
            <StatusBadge
              label={t('Estimated')}
              variant='warning'
              size='sm'
              copyable={false}
            />
          )}
        </TooltipTrigger>
        <TooltipContent side='top'>
          {t('Upstream quota: {{quota}}', {
            quota: cost.upstream_quota.toLocaleString(),
          })}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** Our charge minus the upstream cost, colored by sign. */
export function ProfitLogCell(props: { log: UsageLog }) {
  const { internalAccounting } = useUsageLogsContext()
  const profit = getLogProfit(
    props.log.quota,
    props.log.upstream_cost,
    internalAccounting
  )

  if (profit === null) {
    return <EmptyUpstreamCostCell />
  }

  return (
    <span
      className={cn(
        'font-mono text-xs font-medium tabular-nums',
        getProfitClassName(profit)
      )}
    >
      {formatLogQuota(profit)}
    </span>
  )
}
