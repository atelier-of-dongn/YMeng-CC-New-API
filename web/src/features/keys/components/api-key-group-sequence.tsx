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
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { GroupBadge } from '@/components/group-badge'
import { Button } from '@/components/ui/button'

import {
  ApiKeyGroupCombobox,
  type ApiKeyGroupOption,
} from './api-key-group-combobox'

type ApiKeyGroupSequenceProps = {
  options: ApiKeyGroupOption[]
  value: string[]
  onValueChange: (groups: string[]) => void
}

export function ApiKeyGroupSequence(props: ApiKeyGroupSequenceProps) {
  const { t } = useTranslation()
  const concreteOptions = props.options.filter(
    (option) => option.value !== 'auto'
  )

  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= props.value.length) return
    const next = [...props.value]
    const current = next[index]
    next[index] = next[target]
    next[target] = current
    props.onValueChange(next)
  }

  const remove = (index: number) => {
    props.onValueChange(
      props.value.filter((_, itemIndex) => itemIndex !== index)
    )
  }

  return (
    <div className='space-y-2'>
      <ApiKeyGroupCombobox
        multiple
        options={concreteOptions}
        values={props.value}
        onValuesChange={props.onValueChange}
        placeholder={t('Add a group')}
        disabled={concreteOptions.length === 0}
      />

      {props.value.length === 0 ? (
        <div className='text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-sm'>
          {t('Add groups in the order they should be called')}
        </div>
      ) : (
        <div className='space-y-2'>
          {props.value.map((group, index) => {
            const option = props.options.find((item) => item.value === group)
            const ratio =
              typeof option?.ratio === 'number' ? option.ratio : undefined
            return (
              <div
                key={group}
                className='flex items-center gap-2 rounded-lg border px-3 py-2'
              >
                <span className='text-muted-foreground w-5 shrink-0 text-sm tabular-nums'>
                  {index + 1}
                </span>
                <div className='min-w-0 flex-1'>
                  <GroupBadge group={group} ratio={ratio} />
                </div>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  disabled={index === 0}
                  aria-label={t('Move up')}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp aria-hidden='true' />
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  disabled={index === props.value.length - 1}
                  aria-label={t('Move down')}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown aria-hidden='true' />
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  aria-label={t('Remove group')}
                  onClick={() => remove(index)}
                >
                  <Trash2 aria-hidden='true' />
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
