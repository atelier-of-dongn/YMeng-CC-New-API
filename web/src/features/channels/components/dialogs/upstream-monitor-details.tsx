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
import { AlertTriangle, Globe, Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { GroupBadge, GroupMultiplierBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'
import {
  DetailRow,
  DetailSection,
} from '@/features/usage-logs/components/dialogs/log-detail-layout'
import { formatTimestampToDate } from '@/lib/format'

import {
  formatUpstreamRatio,
  getUpstreamRatioSourceLabel,
} from '../../lib/upstream-cost'
import type { UpstreamMonitorView, UpstreamSiteView } from '../../types'
import {
  UpstreamPricingStatusBadge,
  UpstreamSiteStatusBadge,
} from '../upstream-cost-badges'
import { UpstreamMonitorCostDetails } from './upstream-monitor-cost-details'

const EMPTY_VALUE = '-'

type UpstreamMonitorDetailsProps = {
  monitor: UpstreamMonitorView
  /** Resolved from the sites list; only needed for the site version. */
  site?: UpstreamSiteView
}

/** Read-only snapshot of what the backend knows about a channel's upstream. */
export function UpstreamMonitorDetails(props: UpstreamMonitorDetailsProps) {
  const { t } = useTranslation()
  const monitor = props.monitor
  const keyGroups = monitor.key_groups ?? []
  const sourceLabel = getUpstreamRatioSourceLabel(monitor.ratio_source)

  return (
    <div className='space-y-4'>
      <DetailSection
        icon={<Globe />}
        iconTone='info'
        label={t('Upstream Site')}
      >
        <DetailRow label={t('Name')} value={monitor.site_name || EMPTY_VALUE} />
        <DetailRow
          label={t('Base URL')}
          value={monitor.site_base_url || EMPTY_VALUE}
          mono
        />
        <DetailRow
          label={t('Status')}
          value={<UpstreamSiteStatusBadge status={monitor.site_status} />}
        />
        <DetailRow
          label={t('Version')}
          value={props.site?.version || EMPTY_VALUE}
          mono
        />
        <DetailRow
          label={t('Pricing')}
          value={<UpstreamPricingStatusBadge status={monitor.pricing_status} />}
        />
      </DetailSection>

      <DetailSection
        icon={<Layers />}
        iconTone='chart-1'
        label={t('Group & Ratio')}
      >
        <DetailRow
          label={t('Effective group')}
          value={
            monitor.effective_group ? (
              <span className='flex flex-wrap items-center gap-1'>
                <GroupBadge group={monitor.effective_group} size='sm' />
                {monitor.manual_group && (
                  <StatusBadge
                    label={t('Manual')}
                    variant='blue'
                    size='sm'
                    copyable={false}
                  />
                )}
              </span>
            ) : (
              t('Unknown')
            )
          }
        />
        <DetailRow
          label={t('Detected group')}
          value={monitor.detected_group || EMPTY_VALUE}
        />
        {keyGroups.length > 1 && (
          <DetailRow label={t('Key groups')} value={keyGroups.join(', ')} />
        )}
        <DetailRow
          label={t('Ratio')}
          value={
            monitor.group_ratio > 0 ? (
              <span className='flex flex-wrap items-center gap-2'>
                <GroupMultiplierBadge
                  ratio={monitor.group_ratio}
                  label={formatUpstreamRatio(monitor.group_ratio)}
                />
                {sourceLabel && (
                  <span className='text-muted-foreground'>
                    {t('Source: {{source}}', { source: t(sourceLabel) })}
                  </span>
                )}
              </span>
            ) : (
              t('Unknown')
            )
          }
        />
        {monitor.prev_group_ratio > 0 && (
          <DetailRow
            label={t('Previous ratio')}
            value={
              <span className='flex flex-wrap items-center gap-2'>
                <span className='font-mono'>
                  {formatUpstreamRatio(monitor.prev_group_ratio)} →{' '}
                  {formatUpstreamRatio(monitor.group_ratio)}
                </span>
                {monitor.ratio_changed_at > 0 && (
                  <span className='text-muted-foreground'>
                    {t('Changed at {{time}}', {
                      time: formatTimestampToDate(monitor.ratio_changed_at),
                    })}
                  </span>
                )}
              </span>
            }
          />
        )}
        {monitor.group_mismatch && (
          <p className='text-warning flex items-center gap-1.5 pt-1 text-xs'>
            <AlertTriangle className='size-3.5 shrink-0' aria-hidden='true' />
            {t('The manual group differs from the detected group: {{group}}', {
              group: monitor.detected_group || EMPTY_VALUE,
            })}
          </p>
        )}
      </DetailSection>

      <UpstreamMonitorCostDetails monitor={monitor} />

      {monitor.last_error && (
        <DetailSection
          icon={<AlertTriangle />}
          label={t('Last Error')}
          variant='danger'
        >
          <p className='text-xs break-all whitespace-pre-wrap'>
            {monitor.last_error}
          </p>
        </DetailSection>
      )}

      {monitor.updated_at > 0 && (
        <p className='text-muted-foreground text-xs'>
          {t('Updated at {{time}}', {
            time: formatTimestampToDate(monitor.updated_at),
          })}
        </p>
      )}
    </div>
  )
}
