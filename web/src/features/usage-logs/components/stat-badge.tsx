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
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** Compact label/value chip used by the usage log statistics bar. */
export function StatBadge(props: {
  label: string
  value?: string | number
  accent: string
  /** Optional leading icon rendered before the label (decorative). */
  icon?: ReactNode
  /** Optional rich value content; takes precedence over `value` when set. */
  children?: ReactNode
}) {
  return (
    <span
      data-slot='stat-badge'
      className='border-border/60 bg-muted/25 inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md border px-2 text-xs shadow-xs max-sm:h-auto max-sm:min-h-7 max-sm:w-full max-sm:px-2 max-sm:py-1 sm:whitespace-nowrap'
    >
      <span className={cn('h-3.5 w-0.5 shrink-0 rounded-full', props.accent)} />
      {props.icon != null && (
        <span
          data-slot='stat-icon'
          aria-hidden='true'
          className='text-muted-foreground inline-flex shrink-0 items-center [&_svg]:size-3'
        >
          {props.icon}
        </span>
      )}
      <span className='text-muted-foreground min-w-0 [overflow-wrap:anywhere]'>
        {props.label}
      </span>
      <span className='text-foreground/85 inline-flex min-w-0 items-center gap-1 font-mono font-semibold tabular-nums'>
        {props.children ?? (
          <span className='min-w-0 [overflow-wrap:anywhere] break-all'>
            {props.value}
          </span>
        )}
      </span>
    </span>
  )
}
