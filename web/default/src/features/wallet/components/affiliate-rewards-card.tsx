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
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight, Share2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { getAffiliateSummary } from '@/features/affiliate/api'
import { formatQuota } from '@/lib/format'

import type { UserWalletData } from '../types'

interface AffiliateRewardsCardProps {
  user: UserWalletData | null
  affiliateLink: string
  onTransfer: () => void
  complianceConfirmed?: boolean
  loading?: boolean
}

export function AffiliateRewardsCard({
  user,
  affiliateLink,
  onTransfer,
  complianceConfirmed = true,
  loading,
}: AffiliateRewardsCardProps) {
  const { t } = useTranslation()

  // 邀请数与累计佣金以推广总览为准：users.aff_count 历史数据为 0，
  // 只有新邀请才自增，直接展示会让老用户看到 0。
  const { data: summary } = useQuery({
    queryKey: ['affiliate', 'summary'],
    queryFn: getAffiliateSummary,
  })

  if (loading) {
    return (
      <Card data-card-hover='false' className='bg-muted/20 py-0'>
        <CardContent className='grid gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(220px,1fr)_minmax(220px,0.72fr)_minmax(320px,1.15fr)] lg:items-center'>
          <div>
            <Skeleton className='h-5 w-32' />
            <Skeleton className='mt-2 h-4 w-48' />
          </div>
          <Skeleton className='h-14 rounded-lg' />
          <Skeleton className='h-10 rounded-lg' />
        </CardContent>
      </Card>
    )
  }

  // 推广可用余额存放在 invite_quota，aff_quota 是后端保留的兼容别名。
  const availableQuota =
    summary?.available_quota ?? user?.invite_quota ?? user?.aff_quota ?? 0
  const totalEarned = summary?.total_quota ?? user?.aff_history_quota ?? 0
  const inviteeCount = summary?.invitee_count ?? user?.aff_count ?? 0
  const hasRewards = availableQuota > 0

  return (
    <Card data-card-hover='false' className='bg-muted/20 py-0'>
      <CardContent className='grid gap-3 p-3 sm:gap-4 sm:p-4 lg:grid-cols-[minmax(200px,1fr)_minmax(180px,0.65fr)_minmax(280px,1fr)] lg:items-center'>
        <div className='flex min-w-0 items-center gap-2.5'>
          <div className='bg-background flex size-8 shrink-0 items-center justify-center rounded-lg border'>
            <Share2 className='text-muted-foreground size-4' />
          </div>
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <h3 className='truncate text-sm font-semibold'>
                {t('Referral Program')}
              </h3>
              {summary ? (
                <Badge variant='secondary' className='text-[11px]'>
                  {t('Commission rate: {{rate}}%', {
                    rate: summary.rate_percent,
                  })}
                </Badge>
              ) : null}
            </div>
            <p className='text-muted-foreground line-clamp-1 text-xs'>
              {t(
                'Earn commission when your invited users spend wallet balance. Transfer accumulated commission to your balance anytime.'
              )}
            </p>
          </div>
        </div>

        <div className='grid grid-cols-3 gap-1.5 text-center'>
          {[
            [t('Available'), formatQuota(availableQuota)],
            [t('Total Earned'), formatQuota(totalEarned)],
            [t('Invites'), String(inviteeCount)],
          ].map(([label, value]) => (
            <div key={label}>
              <div className='text-muted-foreground truncate text-xs font-medium tracking-wider uppercase'>
                {label}
              </div>
              <div className='mt-0.5 truncate text-sm font-semibold tabular-nums'>
                {value}
              </div>
            </div>
          ))}
        </div>

        <div className='flex items-center gap-2'>
          <Input
            value={affiliateLink}
            readOnly
            className='border-muted bg-background/70 h-9 min-w-0 flex-1 font-mono text-xs'
          />
          <CopyButton
            value={affiliateLink}
            variant='outline'
            className='bg-background size-9 shrink-0'
            iconClassName='size-4'
            tooltip={t('Copy referral link')}
            aria-label={t('Copy referral link')}
          />
          {hasRewards && (
            <Button
              onClick={onTransfer}
              disabled={!complianceConfirmed}
              className='h-9 shrink-0 px-3'
              size='sm'
            >
              {t('Transfer to Balance')}
            </Button>
          )}
        </div>

        <div className='flex flex-wrap items-center gap-x-3 gap-y-1 lg:col-span-3'>
          <Button
            variant='link'
            size='sm'
            className='h-auto p-0 text-xs'
            render={<Link to='/affiliate' />}
          >
            {t('View commission details')}
            <ArrowRight className='size-3' />
          </Button>
          {summary && !summary.enabled ? (
            <p className='text-muted-foreground text-xs'>
              {t(
                'The affiliate program is currently disabled. Existing balances are kept, but no new commission is settled.'
              )}
            </p>
          ) : null}
          {!complianceConfirmed ? (
            <p className='text-muted-foreground text-xs'>
              {t(
                'Referral reward transfer is disabled until the administrator confirms compliance terms.'
              )}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}