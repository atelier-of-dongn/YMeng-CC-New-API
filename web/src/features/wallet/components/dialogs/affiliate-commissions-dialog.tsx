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
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getAffiliateCommissions } from '@/features/affiliate/api'
import { formatQuota } from '@/lib/format'

const PAGE_SIZE = 20

function formatTimestamp(seconds: number): string {
  if (!seconds) return '-'
  return new Date(seconds * 1000).toLocaleString()
}

interface AffiliateCommissionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AffiliateCommissionsDialog({
  open,
  onOpenChange,
}: AffiliateCommissionsDialogProps) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['affiliate', 'commissions', page],
    queryFn: () => getAffiliateCommissions(page, PAGE_SIZE),
    enabled: open,
  })

  const total = data?.total ?? 0
  const items = data?.items ?? []
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  let body: ReactNode
  if (isLoading) {
    body = <Skeleton className='h-64 rounded-lg' />
  } else if (items.length === 0) {
    body = (
      <p className='text-muted-foreground py-10 text-center text-sm'>
        {t('No commission records yet')}
      </p>
    )
  } else {
    body = (
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
            {items.map((item) => (
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
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Commission records')}
      contentClassName='flex max-h-(--dialog-available-height) flex-col max-sm:w-screen max-sm:max-w-none max-sm:rounded-none max-sm:p-4 sm:max-w-4xl'
      contentHeight='auto'
      bodyClassName='space-y-3'
    >
      <div className='min-h-0 space-y-3'>
        {body}

        {!isLoading && items.length > 0 && (
          <div className='flex flex-col items-center gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between'>
            <div className='text-muted-foreground text-xs sm:text-sm'>
              {t('Showing')} {(page - 1) * PAGE_SIZE + 1}-
              {Math.min(page * PAGE_SIZE, total)} {t('of')} {total}
            </div>
            <div className='flex items-center gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
                className='h-8 w-8 p-0'
                aria-label={t('Previous page')}
              >
                <ChevronLeft className='h-4 w-4' />
              </Button>
              <div className='text-muted-foreground flex items-center gap-1 text-sm'>
                <span className='font-medium'>{page}</span>
                <span>/</span>
                <span>{totalPages}</span>
              </div>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages}
                className='h-8 w-8 p-0'
                aria-label={t('Next page')}
              >
                <ChevronRight className='h-4 w-4' />
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
