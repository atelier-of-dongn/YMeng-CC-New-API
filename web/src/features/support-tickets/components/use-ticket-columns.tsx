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
import type { ColumnDef } from '@tanstack/react-table'
import { Paperclip } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TruncatedCell } from '@/components/data-table'
import { Button } from '@/components/ui/button'

import { formatSupportTicketTime } from '../lib/format'
import type { SupportTicket } from '../types'
import { TicketStatusBadge } from './ticket-status-badge'

export function useTicketColumns(props: {
  admin: boolean
  onView: (ticket: SupportTicket) => void
}): ColumnDef<SupportTicket>[] {
  const { t } = useTranslation()
  return useMemo(
    (): ColumnDef<SupportTicket>[] => [
      ...(props.admin
        ? [
            {
              id: 'username',
              header: t('User'),
              meta: { mobileTitle: true },
              cell: ({ row }: { row: { original: SupportTicket } }) => (
                <div>
                  <div>{row.original.username || '-'}</div>
                  <div className='text-muted-foreground text-xs'>
                    ID: {row.original.user_id}
                  </div>
                </div>
              ),
            } satisfies ColumnDef<SupportTicket>,
          ]
        : []),
      {
        id: 'preview',
        header: t('Summary'),
        meta: props.admin ? undefined : { mobileTitle: true },
        cell: ({ row }) => (
          <div className='flex min-w-0 items-center gap-2'>
            <TruncatedCell className='sm:max-w-80'>
              {row.original.preview || '-'}
            </TruncatedCell>
            {row.original.has_attachment ? (
              <Paperclip
                className='text-muted-foreground size-4 shrink-0'
                aria-label={t('Has attachment')}
              />
            ) : null}
          </div>
        ),
      },
      {
        id: 'request_id',
        header: t('Request ID'),
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <TruncatedCell className='max-w-48 font-mono text-xs'>
            {row.original.request_id || '-'}
          </TruncatedCell>
        ),
      },
      {
        accessorKey: 'status',
        id: 'status',
        header: t('Status'),
        meta: { mobileBadge: true },
        cell: ({ row }) => <TicketStatusBadge status={row.original.status} />,
      },
      {
        id: 'last_message_at',
        header: t('Last activity'),
        cell: ({ row }) => (
          <span className='tabular-nums'>
            {formatSupportTicketTime(row.original.last_message_at)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <div className='text-right'>{t('Actions')}</div>,
        cell: ({ row }) => (
          <div className='text-right'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => props.onView(row.original)}
            >
              {t('View')}
            </Button>
          </div>
        ),
      },
    ],
    [props, t]
  )
}
