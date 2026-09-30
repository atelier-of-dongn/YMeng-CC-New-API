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

import { StatusBadge } from '@/components/status-badge'
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import { cn } from '@/lib/utils'

import {
  getUpstreamCostStatusDisplay,
  getUpstreamPriceBasisLabel,
  getUpstreamPricingStatusDisplay,
  getUpstreamSiteStatusDisplay,
  isTokenPriceBasis,
  type UpstreamStatusDisplay,
} from '../lib/upstream-cost'
import type { UpstreamInvertedModel } from '../types'

const PRICE_FORMAT_OPTIONS = {
  digitsLarge: 4,
  digitsSmall: 6,
  abbreviate: false,
} as const

/** Placeholder for missing upstream data (no monitor row, tag rows, etc.). */
export function UpstreamEmptyValue() {
  return <span className='text-muted-foreground text-xs'>-</span>
}

function UpstreamStatusBadge(props: {
  display: UpstreamStatusDisplay
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <StatusBadge
      label={t(props.display.label)}
      variant={props.display.variant}
      size='sm'
      copyable={false}
      className={props.className}
    />
  )
}

export function UpstreamCostStatusBadge(props: {
  status: string
  className?: string
}) {
  return (
    <UpstreamStatusBadge
      display={getUpstreamCostStatusDisplay(props.status)}
      className={props.className}
    />
  )
}

export function UpstreamSiteStatusBadge(props: {
  status: string
  className?: string
}) {
  return (
    <UpstreamStatusBadge
      display={getUpstreamSiteStatusDisplay(props.status)}
      className={props.className}
    />
  )
}

/** Renders `-` until the upstream pricing endpoint has been fetched. */
export function UpstreamPricingStatusBadge(props: {
  status: string
  className?: string
}) {
  const display = getUpstreamPricingStatusDisplay(props.status)
  if (!display) {
    return <UpstreamEmptyValue />
  }
  return <UpstreamStatusBadge display={display} className={props.className} />
}

/**
 * Lists models whose upstream price exceeds the local price. Colors are
 * inherited so the list reads correctly both in tooltips and in dialogs.
 */
export function UpstreamInvertedModelList(props: {
  models: UpstreamInvertedModel[]
  limit?: number
  className?: string
}) {
  const { t } = useTranslation()
  const visible =
    props.limit === undefined
      ? props.models
      : props.models.slice(0, props.limit)
  const hiddenCount = props.models.length - visible.length

  return (
    <ul className={cn('space-y-1 text-xs', props.className)}>
      {visible.map((item) => {
        const showUpstreamModel =
          item.upstream_model !== '' && item.upstream_model !== item.model
        return (
          <li
            key={`${item.model}:${item.upstream_model}:${item.basis}`}
            className='min-w-0'
          >
            <p className='font-mono break-all'>
              {item.model}
              {showUpstreamModel ? ` → ${item.upstream_model}` : null}
            </p>
            <p className='opacity-80'>
              {t(getUpstreamPriceBasisLabel(item.basis))}
              {': '}
              {t('Upstream')}{' '}
              {formatBillingCurrencyFromUSD(
                item.upstream_usd,
                PRICE_FORMAT_OPTIONS
              )}
              {' > '}
              {t('Local')}{' '}
              {formatBillingCurrencyFromUSD(
                item.local_usd,
                PRICE_FORMAT_OPTIONS
              )}
              {isTokenPriceBasis(item.basis) ? ` ${t('per 1K tokens')}` : null}
            </p>
          </li>
        )
      })}
      {hiddenCount > 0 && (
        <li className='opacity-80'>
          {t('+{{count}} more', { count: hiddenCount })}
        </li>
      )}
    </ul>
  )
}
