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
import { Coins } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import {
  DetailRow,
  DetailSection,
} from '@/features/usage-logs/components/dialogs/log-detail-layout'

import type { UpstreamMonitorView } from '../../types'
import {
  UpstreamCostStatusBadge,
  UpstreamInvertedModelList,
} from '../upstream-cost-badges'

function ModelNameList(props: { models: string[] }) {
  return (
    <span className='flex flex-wrap gap-1'>
      {props.models.map((model) => (
        <StatusBadge
          key={model}
          label={model}
          autoColor={model}
          size='sm'
          className='font-mono'
        />
      ))}
    </span>
  )
}

/** Cost status plus the models behind it (inverted, unknown, mixed billing). */
export function UpstreamMonitorCostDetails(props: {
  monitor: UpstreamMonitorView
}) {
  const { t } = useTranslation()
  const invertedModels = props.monitor.inverted_models ?? []
  const unknownModels = props.monitor.unknown_models ?? []
  const mixedModels = props.monitor.mixed_models ?? []

  return (
    <DetailSection
      icon={<Coins />}
      iconTone='warning'
      label={t('Upstream Cost')}
    >
      <DetailRow
        label={t('Cost Status')}
        value={<UpstreamCostStatusBadge status={props.monitor.cost_status} />}
      />
      {invertedModels.length > 0 && (
        <DetailRow
          label={t('Inverted models')}
          value={<UpstreamInvertedModelList models={invertedModels} />}
        />
      )}
      {unknownModels.length > 0 && (
        <DetailRow
          label={t('Unknown models')}
          value={<ModelNameList models={unknownModels} />}
        />
      )}
      {mixedModels.length > 0 && (
        <DetailRow
          label={t('Mixed billing models')}
          value={
            <span className='flex flex-col gap-1'>
              <ModelNameList models={mixedModels} />
              <span className='text-muted-foreground'>
                {t(
                  'Billed per call on one side and per token on the other, so prices are not compared.'
                )}
              </span>
            </span>
          }
        />
      )}
    </DetailSection>
  )
}
