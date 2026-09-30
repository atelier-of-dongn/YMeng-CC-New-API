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
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { GroupBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { isTagAggregateRow } from '../lib'
import { canSelectUpstreamGroup } from '../lib/upstream-cost'
import type { Channel } from '../types'
import { useChannels } from './channels-provider'
import { UpstreamEmptyValue } from './upstream-cost-badges'
import { useUpstreamMonitor } from './upstream-monitor-provider'

const SENSITIVE_MASK = '••••'

const CONTAINER_CLASS_NAME =
  '-ml-1.5 flex max-w-full min-w-0 items-center gap-1'

/**
 * Effective upstream group with manual/mismatch markers. When a New API site
 * reports no group, a shortcut opens the monitor dialog to pick one.
 */
export function UpstreamGroupCell(props: { channel: Channel }) {
  const { t } = useTranslation()
  const { sensitiveVisible, setCurrentRow, setOpen } = useChannels()
  const monitor = useUpstreamMonitor(props.channel.id)

  if (isTagAggregateRow(props.channel) || !monitor) {
    return <UpstreamEmptyValue />
  }

  if (!monitor.effective_group) {
    if (!canSelectUpstreamGroup(monitor)) {
      return <UpstreamEmptyValue />
    }
    return (
      <Button
        variant='outline'
        size='xs'
        onClick={(event) => {
          event.stopPropagation()
          setCurrentRow(props.channel)
          setOpen('upstream-monitor')
        }}
      >
        {t('Select group')}
      </Button>
    )
  }

  const maskGroup = (group: string) =>
    sensitiveVisible ? group : SENSITIVE_MASK
  const keyGroups = monitor.key_groups ?? []
  const tooltipLines: string[] = []
  if (monitor.group_mismatch) {
    tooltipLines.push(
      t('The manual group differs from the detected group: {{group}}', {
        group: maskGroup(monitor.detected_group || '-'),
      })
    )
  }
  if (keyGroups.length > 1) {
    tooltipLines.push(
      t('Key groups: {{groups}}', {
        groups: keyGroups.map(maskGroup).join(', '),
      })
    )
  }

  const content = (
    <>
      <GroupBadge
        group={monitor.effective_group}
        label={sensitiveVisible ? undefined : SENSITIVE_MASK}
        size='sm'
      />
      {monitor.manual_group && (
        <StatusBadge
          label={t('Manual')}
          variant='blue'
          size='sm'
          copyable={false}
          className='shrink-0'
        />
      )}
      {monitor.group_mismatch && (
        <AlertTriangle
          className='text-warning size-3.5 shrink-0'
          aria-label={t('Group mismatch')}
        />
      )}
    </>
  )

  if (tooltipLines.length === 0) {
    return <span className={CONTAINER_CLASS_NAME}>{content}</span>
  }

  return (
    <TooltipProvider delay={100}>
      <Tooltip>
        <TooltipTrigger
          render={<span className={cn(CONTAINER_CLASS_NAME, 'cursor-help')} />}
        >
          {content}
        </TooltipTrigger>
        <TooltipContent side='top' className='max-w-xs'>
          <div className='space-y-1 text-xs'>
            {tooltipLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
