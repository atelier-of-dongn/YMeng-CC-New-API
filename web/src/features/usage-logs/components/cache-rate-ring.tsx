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
import { formatPercent } from '@/lib/format'

const size = 20
const strokeWidth = 2.5
const radius = (size - strokeWidth) / 2
const circumference = 2 * Math.PI * radius

export function CacheRateRing(props: { rate: number; label: string }) {
  const percent = Math.min(100, Math.max(0, props.rate * 100))
  const formattedRate = formatPercent(percent)
  let colorClass = 'text-destructive'
  let band = 'low'
  if (percent > 90) {
    colorClass = 'text-success'
    band = 'high'
  } else if (percent > 60) {
    colorClass = 'text-warning'
    band = 'medium'
  } else if (percent === 0) {
    band = 'empty'
  }

  return (
    <span
      role='progressbar'
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Number(percent.toFixed(2))}
      aria-valuetext={formattedRate}
      className='inline-flex items-center gap-1.5'
      data-cache-rate-band={band}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className='shrink-0 -rotate-90'
        aria-hidden='true'
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill='none'
          strokeWidth={strokeWidth}
          stroke='currentColor'
          className='text-muted-foreground/35'
          data-cache-rate-track
        />
        {percent > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill='none'
            strokeWidth={strokeWidth}
            strokeLinecap='round'
            stroke='currentColor'
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - percent / 100)}
            className={colorClass}
            data-cache-rate-progress
          />
        )}
      </svg>
      <span className='font-mono text-xs tabular-nums'>{formattedRate}</span>
    </span>
  )
}
