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

import { StaticDataTable } from '@/components/data-table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatQuota } from '@/lib/format'

import type { AffiliateAnalyticsRanking } from '../api'

type RankingsTableProps = {
  data: AffiliateAnalyticsRanking[]
  isLoading: boolean
}

export function RankingsTable(props: RankingsTableProps) {
  const { t } = useTranslation()

  return (
    <Card data-card-hover='false' className='py-0'>
      <CardHeader className='border-b px-4 py-3'>
        <CardTitle className='text-sm'>{t('Top inviters')}</CardTitle>
      </CardHeader>
      <CardContent className='p-0'>
        {props.isLoading ? (
          <div className='space-y-2 p-4'>
            <Skeleton className='h-8 w-full' />
            <Skeleton className='h-8 w-full' />
            <Skeleton className='h-8 w-full' />
          </div>
        ) : (
          <StaticDataTable
            className='rounded-none border-0'
            tableClassName='text-sm'
            columns={[
              {
                id: 'rank',
                header: t('Rank'),
                className: 'w-16',
                cell: (_row, index) => index + 1,
              },
              {
                id: 'inviter',
                header: t('Inviter'),
                cell: (row) => (
                  <span>
                    {row.display_name || row.username || `#${row.inviter_id}`}
                    <span className='text-muted-foreground ms-1 font-mono text-xs'>
                      #{row.inviter_id}
                    </span>
                  </span>
                ),
              },
              {
                id: 'referrals',
                header: t('Referrals'),
                className: 'text-right',
                cellClassName: 'text-right tabular-nums',
                cell: (row) => row.referral_count.toLocaleString(),
              },
              {
                id: 'commissions',
                header: t('Commission events'),
                className: 'text-right',
                cellClassName: 'text-right tabular-nums',
                cell: (row) => row.commission_count.toLocaleString(),
              },
              {
                id: 'credited',
                header: t('Credited quota'),
                className: 'text-right',
                cellClassName: 'text-right tabular-nums',
                cell: (row) => formatQuota(row.credited_quota),
              },
            ]}
            data={props.data}
            getRowKey={(row) => row.inviter_id}
            emptyContent={
              <p className='text-muted-foreground py-8 text-center text-sm'>
                {t('No referrals found for this period')}
              </p>
            }
          />
        )}
      </CardContent>
    </Card>
  )
}
