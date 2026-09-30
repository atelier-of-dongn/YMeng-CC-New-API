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
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

import type {
  UpstreamCostSettingsFormInput,
  UpstreamCostSettingsFormValues,
} from '../lib/upstream-cost-settings'
import { safeNumberFieldProps } from '../utils/numeric-field'

type IntervalFieldName =
  | 'upstream_cost_setting.log_poll_seconds'
  | 'upstream_cost_setting.pricing_minutes'
  | 'upstream_cost_setting.ratio_change_hold_hours'
  | 'upstream_cost_setting.retention_days'

type UpstreamCostIntervalFieldsProps = {
  form: UseFormReturn<
    UpstreamCostSettingsFormInput,
    unknown,
    UpstreamCostSettingsFormValues
  >
}

/** Polling, refresh, hold, and retention intervals of the cost monitor. */
export function UpstreamCostIntervalFields(
  props: UpstreamCostIntervalFieldsProps
) {
  const { t } = useTranslation()
  const fields: Array<{
    name: IntervalFieldName
    label: string
    description: string
    min: number
  }> = [
    {
      name: 'upstream_cost_setting.log_poll_seconds',
      label: t('Log polling interval (seconds)'),
      description: t('Minimum 30 seconds'),
      min: 30,
    },
    {
      name: 'upstream_cost_setting.pricing_minutes',
      label: t('Pricing refresh interval (minutes)'),
      description: t('How often upstream group ratios and prices are fetched'),
      min: 1,
    },
    {
      name: 'upstream_cost_setting.ratio_change_hold_hours',
      label: t('Ratio change hold (hours)'),
      description: t('How long a ratio change stays flagged on the channel'),
      min: 1,
    },
    {
      name: 'upstream_cost_setting.retention_days',
      label: t('Retention days'),
      description: t('0 means data is kept permanently'),
      min: 0,
    },
  ]

  return (
    <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4'>
      {fields.map((item) => (
        <FormField
          key={item.name}
          control={props.form.control}
          name={item.name}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{item.label}</FormLabel>
              <FormControl>
                <Input
                  type='number'
                  min={item.min}
                  step={1}
                  {...safeNumberFieldProps(field)}
                />
              </FormControl>
              <FormDescription>{item.description}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      ))}
    </div>
  )
}
