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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TruncatedCell } from '@/components/data-table'

import { formatInvoiceAmount, formatInvoiceTime } from '../lib'
import type { InvoiceApplication } from '../types'
import {
  AdminInvoiceRowActions,
  type AdminInvoiceRowActionHandlers,
} from './admin-invoice-row-actions'
import { InvoiceStatusDetails } from './invoice-status-details'

export function useAdminInvoiceColumns(
  handlers: AdminInvoiceRowActionHandlers
): ColumnDef<InvoiceApplication>[] {
  const { t } = useTranslation()

  return useMemo(
    (): ColumnDef<InvoiceApplication>[] => [
      {
        id: 'user',
        header: t('User'),
        meta: { mobileTitle: true },
        cell: ({ row }) => (
          <div className='min-w-0'>
            <TruncatedCell
              className='font-medium sm:max-w-[140px]'
              tabIndex={0}
            >
              {row.original.username || '-'}
            </TruncatedCell>
            <div className='text-muted-foreground text-xs tabular-nums'>
              ID: {row.original.user_id}
            </div>
          </div>
        ),
      },
      {
        id: 'invoice',
        header: t('Invoice information'),
        cell: ({ row }) => (
          <div className='min-w-0'>
            <TruncatedCell
              className='font-medium sm:max-w-[220px]'
              tabIndex={0}
            >
              {row.original.title}
            </TruncatedCell>
            <TruncatedCell
              className='text-muted-foreground text-xs sm:max-w-[220px]'
              tabIndex={0}
            >
              {row.original.tax_id}
            </TruncatedCell>
          </div>
        ),
      },
      {
        id: 'orders',
        header: t('Orders'),
        cell: ({ row }) => {
          const orderNumbers = row.original.items
            .filter((item) => item.type === 'order' && item.trade_no)
            .map((item) => item.trade_no)
            .join(', ')
          return (
            <div className='max-w-64 truncate' title={orderNumbers}>
              {orderNumbers || '-'}
            </div>
          )
        },
      },
      {
        id: 'gross_amount',
        header: t('Order amount'),
        cell: ({ row }) => (
          <span className='tabular-nums'>
            {formatInvoiceAmount(row.original.gross_amount)}
          </span>
        ),
      },
      {
        id: 'refund_amount',
        header: t('Refund deduction'),
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <span className='tabular-nums'>
            -{formatInvoiceAmount(row.original.refund_amount)}
          </span>
        ),
      },
      {
        id: 'net_amount',
        header: t('Net invoice amount'),
        cell: ({ row }) => (
          <span className='font-medium tabular-nums'>
            {formatInvoiceAmount(row.original.net_amount)}
          </span>
        ),
      },
      {
        id: 'created_at',
        header: t('Applied at'),
        cell: ({ row }) => (
          <span className='tabular-nums'>
            {formatInvoiceTime(row.original.created_at)}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        id: 'status',
        header: t('Status'),
        meta: { mobileBadge: true },
        cell: ({ row }) => (
          <InvoiceStatusDetails
            status={row.original.status}
            rejectReason={row.original.reject_reason}
          />
        ),
      },
      {
        id: 'actions',
        header: () => <div className='text-right'>{t('Actions')}</div>,
        cell: ({ row }) => (
          <AdminInvoiceRowActions {...handlers} application={row.original} />
        ),
      },
    ],
    [handlers, t]
  )
}
