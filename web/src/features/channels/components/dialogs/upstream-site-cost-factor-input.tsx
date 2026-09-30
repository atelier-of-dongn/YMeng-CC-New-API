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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2 } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { updateUpstreamSite } from '../../api'
import { upstreamCostQueryKeys } from '../../lib'
import {
  UPSTREAM_COST_FACTOR_MAX,
  parseUpstreamCostFactor,
} from '../../lib/upstream-cost'
import type { UpstreamSiteView } from '../../types'

/**
 * Inline cost factor editor. Decimal factors (0 < f <= 100) rule out the
 * integer-only NumericSpinnerInput used for priority and weight.
 */
export function UpstreamSiteCostFactorInput(props: { site: UpstreamSiteView }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const errorId = useId()
  const [value, setValue] = useState(String(props.site.cost_factor))
  const costFactor = parseUpstreamCostFactor(value)
  const invalid = costFactor === null
  const changed = costFactor !== null && costFactor !== props.site.cost_factor

  const mutation = useMutation({
    mutationFn: async (nextCostFactor: number) =>
      requireServerSuccess(
        await updateUpstreamSite(props.site.id, { cost_factor: nextCostFactor })
      ),
    onSuccess: () => {
      toast.success(t('Cost factor updated'))
      void queryClient.invalidateQueries({
        queryKey: upstreamCostQueryKeys.sites,
      })
    },
    onError: (error) => {
      handleServerError(error, t('Failed to update cost factor'))
    },
  })

  const save = () => {
    if (costFactor === null || !changed || mutation.isPending) {
      return
    }
    mutation.mutate(costFactor)
  }

  return (
    <div className='flex flex-col gap-1'>
      <InputGroup className='w-28'>
        <InputGroupInput
          type='number'
          inputMode='decimal'
          min={0}
          max={UPSTREAM_COST_FACTOR_MAX}
          step={0.01}
          value={value}
          disabled={mutation.isPending}
          aria-label={t('Cost Factor')}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              save()
            }
          }}
          className='font-mono'
        />
        <InputGroupAddon align='inline-end'>
          <InputGroupButton
            size='icon-xs'
            onClick={save}
            disabled={!changed || mutation.isPending}
            aria-label={t('Save')}
          >
            {mutation.isPending ? (
              <Loader2 className='animate-spin' />
            ) : (
              <Check />
            )}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {invalid && (
        <p id={errorId} className='text-destructive text-xs'>
          {t('Enter a value greater than 0 and at most 100')}
        </p>
      )}
    </div>
  )
}
