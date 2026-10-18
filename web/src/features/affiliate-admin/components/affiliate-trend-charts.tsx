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
import { VChart } from '@visactor/react-vchart'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { useTheme } from '@/context/theme-provider'
import { formatQuota } from '@/lib/format'
import { VCHART_OPTION } from '@/lib/vchart'

import type { AffiliateAnalyticsTrend } from '../api'

type AffiliateTrendChartsProps = {
  data: AffiliateAnalyticsTrend[]
  isLoading: boolean
}

let themeManagerPromise: Promise<
  (typeof import('@visactor/vchart'))['ThemeManager']
> | null = null

export function AffiliateTrendCharts(props: AffiliateTrendChartsProps) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const [themeReady, setThemeReady] = useState(false)

  useEffect(() => {
    let active = true
    const setTheme = async () => {
      if (!themeManagerPromise) {
        themeManagerPromise = import('@visactor/vchart').then(
          (module) => module.ThemeManager
        )
      }
      const ThemeManager = await themeManagerPromise
      ThemeManager.setCurrentTheme(resolvedTheme === 'dark' ? 'dark' : 'light')
      if (active) setThemeReady(true)
    }
    setTheme()
    return () => {
      active = false
    }
  }, [resolvedTheme])

  const charts = [
    {
      key: 'referral_count',
      title: t('Referral registrations'),
      valueLabel: t('Registrations'),
      format: (value: number) => value.toLocaleString(),
    },
    {
      key: 'credited_quota',
      title: t('Credited commission trend'),
      valueLabel: t('Credited quota'),
      format: (value: number) => formatQuota(value),
    },
  ] as const

  return (
    <div className='grid gap-3 lg:grid-cols-2'>
      {charts.map((chart) => (
        <section key={chart.key} className='overflow-hidden rounded-lg border'>
          <h2 className='border-b px-4 py-3 text-sm font-semibold'>
            {chart.title}
          </h2>
          <div className='h-[280px] p-2 sm:h-[320px]'>
            {props.isLoading || !themeReady ? (
              <Skeleton className='h-full w-full' />
            ) : (
              <VChart
                key={`${chart.key}-${resolvedTheme}`}
                spec={{
                  type: 'line',
                  data: [
                    {
                      id: chart.key,
                      values: props.data.map((point) => ({
                        date: point.date,
                        value: point[chart.key],
                      })),
                    },
                  ],
                  xField: 'date',
                  yField: 'value',
                  line: { style: { lineWidth: 2 } },
                  point: {
                    visible: props.data.length <= 31,
                    style: { size: 8 },
                  },
                  tooltip: {
                    visible: true,
                    dimension: {
                      content: [
                        {
                          key: chart.valueLabel,
                          value: (datum: { value?: number } | undefined) =>
                            chart.format(datum?.value ?? 0),
                        },
                      ],
                    },
                    mark: {
                      content: [
                        {
                          key: chart.valueLabel,
                          value: (datum: { value?: number } | undefined) =>
                            chart.format(datum?.value ?? 0),
                        },
                      ],
                    },
                  },
                  axes: [
                    { orient: 'bottom', type: 'band' },
                    { orient: 'left', type: 'linear' },
                  ],
                  theme: resolvedTheme === 'dark' ? 'dark' : 'light',
                  background: 'transparent',
                }}
                option={VCHART_OPTION}
              />
            )}
          </div>
          <table className='sr-only'>
            <caption>{chart.title}</caption>
            <thead>
              <tr>
                <th>{t('Date')}</th>
                <th>{chart.valueLabel}</th>
              </tr>
            </thead>
            <tbody>
              {props.data.map((point) => (
                <tr key={point.date}>
                  <td>{point.date}</td>
                  <td>{chart.format(point[chart.key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}
