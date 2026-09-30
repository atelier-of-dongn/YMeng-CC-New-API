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

import { GroupMultiplierBadge } from '@/components/group-badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatTimestampToDate } from '@/lib/format'

import { isTagAggregateRow } from '../lib'
import {
  MAX_UPSTREAM_TOOLTIP_MODELS,
  formatUpstreamRatio,
  getUpstreamRatioSourceLabel,
} from '../lib/upstream-cost'
import type { Channel } from '../types'
import {
  UpstreamCostStatusBadge,
  UpstreamEmptyValue,
  UpstreamInvertedModelList,
} from './upstream-cost-badges'
import { useUpstreamMonitor } from './upstream-monitor-provider'

/** Upstream group ratio with its source and the latest change. */
export function UpstreamRatioCell(props: { channel: Channel }) {
  const { t } = useTranslation()
  const monitor = useUpstreamMonitor(props.channel.id)

  if (
    isTagAggregateRow(props.channel) ||
    !monitor ||
    monitor.group_ratio <= 0
  ) {
    return <UpstreamEmptyValue />
  }

  const sourceLabel = getUpstreamRatioSourceLabel(monitor.ratio_source)
  const hasPreviousRatio = monitor.prev_group_ratio > 0

  return (
    <TooltipProvider delay={100}>
      <Tooltip>
        <TooltipTrigger render={<span className='inline-flex cursor-help' />}>
          <GroupMultiplierBadge
            ratio={monitor.group_ratio}
            label={formatUpstreamRatio(monitor.group_ratio)}
          />
        </TooltipTrigger>
        <TooltipContent side='top' className='max-w-xs'>
          <div className='space-y-1 text-xs'>
            <p>
              {t('Source: {{source}}', {
                source: sourceLabel ? t(sourceLabel) : t('Unknown'),
              })}
            </p>
            {hasPreviousRatio && (
              <p className='font-mono'>
                {formatUpstreamRatio(monitor.prev_group_ratio)} →{' '}
                {formatUpstreamRatio(monitor.group_ratio)}
              </p>
            )}
            {hasPreviousRatio && monitor.ratio_changed_at > 0 && (
              <p>
                {t('Changed at {{time}}', {
                  time: formatTimestampToDate(monitor.ratio_changed_at),
                })}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** Cost status badge; inverted channels list the affected models on hover. */
export function UpstreamCostStatusCell(props: { channel: Channel }) {
  const monitor = useUpstreamMonitor(props.channel.id)

  if (isTagAggregateRow(props.channel) || !monitor) {
    return <UpstreamEmptyValue />
  }

  const invertedModels = monitor.inverted_models ?? []
  const badge = (
    <UpstreamCostStatusBadge status={monitor.cost_status} className='-ml-1.5' />
  )
  if (monitor.cost_status !== 'inverted' || invertedModels.length === 0) {
    return badge
  }

  return (
    <TooltipProvider delay={100}>
      <Tooltip>
        <TooltipTrigger render={<span className='inline-flex cursor-help' />}>
          {badge}
        </TooltipTrigger>
        <TooltipContent side='top' className='max-w-sm'>
          <UpstreamInvertedModelList
            models={invertedModels}
            limit={MAX_UPSTREAM_TOOLTIP_MODELS}
          />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
