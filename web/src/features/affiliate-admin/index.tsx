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
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { PaginationState } from '@tanstack/react-table'
import { Coins, HandCoins, UserPlus, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StatCard } from '@/features/dashboard/components/ui/stat-card'
import { useDebounce } from '@/hooks'
import { formatQuota } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'
import { getRollingDateRange } from '@/lib/time'

import {
  getAffiliateAnalyticsCommissions,
  getAffiliateAnalyticsOverview,
  getAffiliateAnalyticsRankings,
} from './api'
import { AffiliateTrendCharts } from './components/affiliate-trend-charts'
import { CommissionsTable } from './components/commissions-table'
import { RankingsTable } from './components/rankings-table'

const RANGE_PRESETS = [
  { label: '7 Days', days: 7 },
  { label: '30 Days', days: 30 },
  { label: '90 Days', days: 90 },
  { label: '365 Days', days: 365 },
] as const

const STATUS_ALL = 'all'
const RANKING_LIMIT = 10
const DEFAULT_PAGINATION: PaginationState = { pageIndex: 0, pageSize: 20 }

export function AffiliateAdminAnalytics() {
  const { t } = useTranslation()
  const [rangeDays, setRangeDays] = useState<number>(30)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<string>(STATUS_ALL)
  const [pagination, setPagination] =
    useState<PaginationState>(DEFAULT_PAGINATION)
  const debouncedKeyword = useDebounce(keyword.trim(), 400)

  // The rolling window is frozen per selection so query keys stay stable.
  const range = useMemo(() => {
    const { start, end } = getRollingDateRange(rangeDays)
    return {
      start_timestamp: Math.floor(start.getTime() / 1000),
      end_timestamp: Math.floor(end.getTime() / 1000),
    }
  }, [rangeDays])

  const overviewQuery = useQuery({
    queryKey: ['affiliate-admin', 'overview', range],
    queryFn: async () =>
      requireServerSuccess(await getAffiliateAnalyticsOverview(range)).data,
    placeholderData: keepPreviousData,
  })

  const rankingsQuery = useQuery({
    queryKey: ['affiliate-admin', 'rankings', range],
    queryFn: async () =>
      requireServerSuccess(
        await getAffiliateAnalyticsRankings({
          range,
          page: 1,
          page_size: RANKING_LIMIT,
        })
      ).data,
    placeholderData: keepPreviousData,
  })

  const commissionsQuery = useQuery({
    queryKey: [
      'affiliate-admin',
      'commissions',
      range,
      debouncedKeyword,
      status,
      pagination.pageIndex,
      pagination.pageSize,
    ],
    queryFn: async () =>
      requireServerSuccess(
        await getAffiliateAnalyticsCommissions({
          range,
          keyword: debouncedKeyword || undefined,
          status: status === STATUS_ALL ? undefined : status,
          page: pagination.pageIndex + 1,
          page_size: pagination.pageSize,
        })
      ).data,
    placeholderData: keepPreviousData,
  })

  const statusItems = [
    { value: STATUS_ALL, label: t('All statuses') },
    { value: 'completed', label: t('Completed') },
    { value: 'pending', label: t('Pending') },
    { value: 'failed', label: t('Failed') },
  ]
  const selectedStatus = statusItems.find((item) => item.value === status)

  const overview = overviewQuery.data?.overview
  const trend = overviewQuery.data?.trend ?? []
  const overviewLoading = overviewQuery.isLoading
  const cards = [
    {
      key: 'referrals',
      title: t('Referral registrations'),
      value: (overview?.referral_count ?? 0).toLocaleString(),
      description: t('Users registered with an inviter in this period'),
      icon: UserPlus,
      tone: 'accent-1' as const,
      sparkline: trend.map((point) => point.referral_count),
    },
    {
      key: 'inviters',
      title: t('Active inviters'),
      value: (overview?.active_inviter_count ?? 0).toLocaleString(),
      description: t('Inviters with at least one registration in this period'),
      icon: Users,
      tone: 'accent-2' as const,
    },
    {
      key: 'commission-events',
      title: t('Commission events'),
      value: (overview?.commission_count ?? 0).toLocaleString(),
      description: t('Completed commission settlements in this period'),
      icon: HandCoins,
      tone: 'accent-3' as const,
      sparkline: trend.map((point) => point.commission_count),
    },
    {
      key: 'credited-quota',
      title: t('Credited quota'),
      value: formatQuota(overview?.credited_quota ?? 0),
      description: t('Commission quota credited to inviters in this period'),
      icon: Coins,
      tone: 'accent-1' as const,
      sparkline: trend.map((point) => point.credited_quota),
    },
  ]

  const resetPage = () => setPagination((prev) => ({ ...prev, pageIndex: 0 }))

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Referral Analytics')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-3 sm:space-y-4'>
          <div className='flex items-center gap-1.5 overflow-x-auto pb-1 sm:gap-2'>
            <Tabs
              value={String(rangeDays)}
              onValueChange={(value) => {
                setRangeDays(Number(value))
                resetPage()
              }}
              className='shrink-0'
            >
              <TabsList aria-label={t('Time range')}>
                {RANGE_PRESETS.map((preset) => (
                  <TabsTrigger
                    key={preset.days}
                    value={String(preset.days)}
                    className='px-2.5 text-xs'
                  >
                    {t(preset.label)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          <div className='grid grid-cols-2 gap-1.5 sm:gap-3 lg:grid-cols-4'>
            {cards.map((card) => (
              <div
                key={card.key}
                className='bg-background/60 rounded-lg border px-2 py-1.5 sm:rounded-xl sm:p-3'
              >
                <StatCard
                  title={card.title}
                  value={card.value}
                  description={card.description}
                  icon={card.icon}
                  tone={card.tone}
                  sparkline={card.sparkline}
                  sparklineVariant='line'
                  loading={overviewLoading}
                  error={overviewQuery.isError}
                  compactMobile
                />
              </div>
            ))}
          </div>

          <AffiliateTrendCharts data={trend} isLoading={overviewLoading} />

          <RankingsTable
            data={rankingsQuery.data?.items ?? []}
            isLoading={rankingsQuery.isLoading}
          />

          <section className='space-y-2'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <h2 className='text-sm font-semibold'>
                {t('Commission records')}
              </h2>
              <div className='flex flex-wrap items-center gap-2'>
                <Input
                  value={keyword}
                  onChange={(event) => {
                    setKeyword(event.target.value)
                    resetPage()
                  }}
                  placeholder={t('Search inviter or invited user')}
                  aria-label={t('Search inviter or invited user')}
                  className='h-8 w-56'
                />
                <Select
                  items={statusItems}
                  value={status}
                  onValueChange={(value) => {
                    setStatus(value ?? STATUS_ALL)
                    resetPage()
                  }}
                >
                  <SelectTrigger aria-label={t('Status')} className='w-36'>
                    <SelectValue>{selectedStatus?.label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {statusItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <CommissionsTable
              data={commissionsQuery.data?.items ?? []}
              total={commissionsQuery.data?.total ?? 0}
              pagination={pagination}
              onPaginationChange={setPagination}
              isLoading={commissionsQuery.isLoading}
              isFetching={commissionsQuery.isFetching}
            />
          </section>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
