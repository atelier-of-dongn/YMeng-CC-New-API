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
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { generateAffiliateLink } from '@/lib/affiliate'
import { formatQuota } from '@/lib/format'

import {
  getAffiliateCommissions,
  getAffiliateInvitees,
  getAffiliateSummary,
} from './api'

const PAGE_SIZE = 20

function formatTimestamp(seconds: number): string {
  if (!seconds) return '-'
  return new Date(seconds * 1000).toLocaleString()
}

function SummaryCards() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['affiliate', 'summary'],
    queryFn: getAffiliateSummary,
  })

  if (isLoading) {
    return (
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
        {['available', 'total', 'invitees', 'records'].map((slot) => (
          <Skeleton key={slot} className='h-20 rounded-lg' />
        ))}
      </div>
    )
  }
  if (!data) return null

  const affiliateLink = generateAffiliateLink(data.aff_code)

  const cards = [
    {
      label: t('Available commission'),
      value: formatQuota(data.available_quota),
    },
    {
      label: t('Total commission earned'),
      value: formatQuota(data.total_quota),
    },
    { label: t('Invited users'), value: String(data.invitee_count) },
    { label: t('Commission records'), value: String(data.commission_count) },
  ]

  return (
    <div className='space-y-3'>
      {!data.enabled && (
        <Alert>
          <AlertDescription>
            {t(
              'The affiliate program is currently disabled. Existing balances are kept, but no new commission is settled.'
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
        {cards.map((card) => (
          <Card key={card.label} data-card-hover='false' className='py-0'>
            <CardContent className='p-4'>
              <p className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                {card.label}
              </p>
              <p className='mt-1 text-xl font-semibold tabular-nums'>
                {card.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card data-card-hover='false' className='py-0'>
        <CardContent className='space-y-3 p-4'>
          <div className='flex flex-wrap items-center gap-2'>
            <p className='text-sm font-medium'>{t('Your referral link')}</p>
            <Badge variant='secondary'>
              {t('Commission rate: {{rate}}%', { rate: data.rate_percent })}
            </Badge>
          </div>
          <div className='flex items-center gap-2'>
            <Input
              value={affiliateLink}
              readOnly
              className='bg-background/70 h-9 flex-1 font-mono text-xs'
            />
            <CopyButton
              value={affiliateLink}
              variant='outline'
              className='bg-background size-9 shrink-0'
              iconClassName='size-4'
              tooltip={t('Copy referral link')}
              aria-label={t('Copy referral link')}
            />
          </div>
          <p className='text-muted-foreground text-xs'>
            {t(
              'You earn commission on the wallet balance your invited users spend. Subscription usage does not generate commission. Fractions below one quota unit are carried over to the next settlement.'
            )}
          </p>
          {data.pending_remainder > 0 && (
            <p className='text-muted-foreground text-xs'>
              {t('Carried-over fraction: {{value}}', {
                value: data.pending_remainder.toFixed(6),
              })}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function CommissionsTable() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['affiliate', 'commissions'],
    queryFn: () => getAffiliateCommissions(1, PAGE_SIZE),
  })

  if (isLoading) return <Skeleton className='h-64 rounded-lg' />
  if (!data || data.items.length === 0) {
    return (
      <p className='text-muted-foreground py-10 text-center text-sm'>
        {t('No commission records yet')}
      </p>
    )
  }

  return (
    <div className='space-y-2'>
      <div className='overflow-x-auto rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Time')}</TableHead>
              <TableHead>{t('Invited user')}</TableHead>
              <TableHead>{t('Model')}</TableHead>
              <TableHead className='text-right'>{t('Consumed')}</TableHead>
              <TableHead className='text-right'>{t('Rate')}</TableHead>
              <TableHead className='text-right'>{t('Commission')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className='text-xs whitespace-nowrap'>
                  {formatTimestamp(item.created_at)}
                </TableCell>
                <TableCell className='text-xs'>
                  {item.invitee_name || `#${item.invitee_id}`}
                </TableCell>
                <TableCell className='font-mono text-xs'>
                  {item.model_name || '-'}
                </TableCell>
                <TableCell className='text-right text-xs tabular-nums'>
                  {formatQuota(item.consumed_quota)}
                </TableCell>
                <TableCell className='text-right text-xs tabular-nums'>
                  {item.rate_percent}%
                </TableCell>
                <TableCell className='text-right text-xs font-medium tabular-nums'>
                  {formatQuota(item.credited_quota)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className='text-muted-foreground text-xs'>
        {t('Showing the latest {{count}} of {{total}} records', {
          count: data.items.length,
          total: data.total,
        })}
      </p>
    </div>
  )
}

function InviteesTable() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['affiliate', 'invitees'],
    queryFn: () => getAffiliateInvitees(1, PAGE_SIZE),
  })

  if (isLoading) return <Skeleton className='h-64 rounded-lg' />
  if (!data || data.items.length === 0) {
    return (
      <p className='text-muted-foreground py-10 text-center text-sm'>
        {t('No invited users yet')}
      </p>
    )
  }

  return (
    <div className='space-y-2'>
      <div className='overflow-x-auto rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('User')}</TableHead>
              <TableHead>{t('Registered at')}</TableHead>
              <TableHead className='text-right'>{t('Records')}</TableHead>
              <TableHead className='text-right'>{t('Commission')}</TableHead>
              <TableHead>{t('Last reward')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((item) => (
              <TableRow key={item.user_id}>
                <TableCell className='text-xs'>
                  <div className='font-medium'>
                    {item.display_name || `#${item.user_id}`}
                  </div>
                  <div className='text-muted-foreground font-mono'>
                    {item.masked_email}
                  </div>
                </TableCell>
                <TableCell className='text-xs whitespace-nowrap'>
                  {formatTimestamp(item.registered_at)}
                </TableCell>
                <TableCell className='text-right text-xs tabular-nums'>
                  {item.commission_count}
                </TableCell>
                <TableCell className='text-right text-xs font-medium tabular-nums'>
                  {formatQuota(item.credited_quota)}
                </TableCell>
                <TableCell className='text-xs whitespace-nowrap'>
                  {formatTimestamp(item.last_reward_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className='text-muted-foreground text-xs'>
        {t('Showing the latest {{count}} of {{total}} records', {
          count: data.items.length,
          total: data.total,
        })}
      </p>
    </div>
  )
}

export function Affiliate() {
  const { t } = useTranslation()

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Referral Program')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          <SummaryCards />

          <Tabs defaultValue='commissions'>
            <TabsList>
              <TabsTrigger value='commissions'>
                {t('Commission records')}
              </TabsTrigger>
              <TabsTrigger value='invitees'>{t('Invited users')}</TabsTrigger>
            </TabsList>
            <TabsContent value='commissions' className='mt-3'>
              <CommissionsTable />
            </TabsContent>
            <TabsContent value='invitees' className='mt-3'>
              <InviteesTable />
            </TabsContent>
          </Tabs>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
