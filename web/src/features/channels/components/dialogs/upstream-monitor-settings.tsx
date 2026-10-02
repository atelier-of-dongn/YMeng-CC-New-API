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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { formatUpstreamRatio } from '../../lib/upstream-cost'
import type {
  UpdateUpstreamMonitorParams,
  UpstreamGroupOption,
} from '../../types'

/** Select value standing in for an empty manual group (automatic detection). */
const AUTO_DETECT_GROUP_VALUE = '__auto_detect__'

type UpstreamMonitorSettingsProps = {
  values: UpdateUpstreamMonitorParams
  groups: UpstreamGroupOption[]
  disabled?: boolean
  onChange: (values: UpdateUpstreamMonitorParams) => void
}

export function UpstreamMonitorSettings(props: UpstreamMonitorSettingsProps) {
  const { t } = useTranslation()
  const groupItems = [
    { value: AUTO_DETECT_GROUP_VALUE, label: t('Auto detect') },
    ...props.groups.map((group) => ({ value: group.name, label: group.name })),
  ]

  return (
    <FieldGroup className='gap-4'>
      <Field>
        <FieldLabel htmlFor='upstream-monitor-mode'>
          {t('Monitoring mode')}
        </FieldLabel>
        <Select
          items={[
            { value: 'auto', label: t('Automatic') },
            { value: 'manual', label: t('Manual') },
            { value: 'off', label: t('Off') },
          ]}
          value={props.values.mode}
          disabled={props.disabled}
          onValueChange={(value) => {
            if (value === 'auto' || value === 'manual' || value === 'off') {
              props.onChange({ ...props.values, mode: value })
            }
          }}
        >
          <SelectTrigger id='upstream-monitor-mode' className='w-full'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='auto'>{t('Automatic')}</SelectItem>
            <SelectItem value='manual'>{t('Manual')}</SelectItem>
            <SelectItem value='off'>{t('Off')}</SelectItem>
          </SelectContent>
        </Select>
        <FieldDescription>
          {t('When off, the upstream cost of this channel is not tracked.')}
        </FieldDescription>
      </Field>

      {props.values.mode === 'manual' && (
        <Field>
          <FieldLabel htmlFor='upstream-manual-ratio'>
            {t('Manual upstream multiplier')}
          </FieldLabel>
          <Input
            id='upstream-manual-ratio'
            type='number'
            min='0.000001'
            max='100'
            step='any'
            value={props.values.manual_ratio ?? ''}
            disabled={props.disabled}
            aria-invalid={
              props.values.manual_ratio !== null &&
              (props.values.manual_ratio <= 0 ||
                props.values.manual_ratio > 100)
            }
            onChange={(event) => {
              const value = event.target.value
              props.onChange({
                ...props.values,
                manual_ratio: value === '' ? null : Number(value),
              })
            }}
          />
          <FieldDescription>
            {t('Enter a multiplier greater than 0 and at most 100.')}
          </FieldDescription>
        </Field>
      )}

      {props.values.mode === 'auto' && (
        <Field>
          <FieldLabel htmlFor='upstream-monitor-group'>
            {t('Upstream Group')}
          </FieldLabel>
          <Select
            items={groupItems}
            value={props.values.manual_group || AUTO_DETECT_GROUP_VALUE}
            disabled={props.disabled}
            onValueChange={(value) =>
              props.onChange({
                ...props.values,
                manual_group:
                  value === null || value === AUTO_DETECT_GROUP_VALUE
                    ? ''
                    : value,
              })
            }
          >
            <SelectTrigger id='upstream-monitor-group' className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                <SelectItem value={AUTO_DETECT_GROUP_VALUE}>
                  {t('Auto detect')}
                </SelectItem>
                {props.groups.map((group) => (
                  <SelectItem key={group.name} value={group.name}>
                    <span className='truncate'>{group.name}</span>
                    {group.ratio > 0 && (
                      <span className='text-muted-foreground font-mono text-xs'>
                        {formatUpstreamRatio(group.ratio)}
                      </span>
                    )}
                    {group.offline && (
                      <StatusBadge
                        label={t('Offline')}
                        variant='danger'
                        size='sm'
                        copyable={false}
                      />
                    )}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            {t(
              'Auto detect uses the group reported by the upstream. Pick a group to override it.'
            )}
          </FieldDescription>
        </Field>
      )}
    </FieldGroup>
  )
}
