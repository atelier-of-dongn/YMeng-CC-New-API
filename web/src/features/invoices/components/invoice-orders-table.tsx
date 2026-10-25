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
import { Checkbox } from '@/components/ui/checkbox'
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { InvoiceStatus } from '@/features/invoices/components/invoice-status'

import { formatInvoiceAmount, formatInvoiceTime } from '../lib'
import type { InvoiceEligibility } from '../types'

export type InvoiceOrdersTableProps = {
  eligibility: InvoiceEligibility
  selectedIds: Set<number>
  onToggleOrder: (id: number, checked: boolean) => void
}

export function InvoiceOrdersTable(props: InvoiceOrdersTableProps) {
  const { t } = useTranslation()
  const orders = props.eligibility.orders.filter(
    (order) => order.invoice_status !== 'issued'
  )
  return (
    <StaticDataTable
      className='overflow-x-auto'
      tableProps={{ withContainer: false }}
    >
      <TableHeader>
        <TableRow>
          <TableHead className='w-12'>{t('Select')}</TableHead>
          <TableHead>{t('Order number')}</TableHead>
          <TableHead>{t('Completed at')}</TableHead>
          <TableHead>{t('Amount')}</TableHead>
          <TableHead>{t('Status')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className='text-center'>
              {t('No invoiceable recharge orders')}
            </TableCell>
          </TableRow>
        )}
        {orders.map((order) => (
          <TableRow key={order.id}>
            <TableCell>
              <Checkbox
                aria-label={t('Select order {{number}}', {
                  number: order.trade_no,
                })}
                checked={
                  Boolean(order.invoice_status) ||
                  props.selectedIds.has(order.id)
                }
                disabled={Boolean(order.invoice_status)}
                onCheckedChange={(checked) =>
                  props.onToggleOrder(order.id, checked === true)
                }
              />
            </TableCell>
            <TableCell className='max-w-64 truncate' title={order.trade_no}>
              {order.trade_no}
            </TableCell>
            <TableCell className='tabular-nums'>
              {formatInvoiceTime(order.completed_at)}
            </TableCell>
            <TableCell className='tabular-nums'>
              {formatInvoiceAmount(order.amount)}
            </TableCell>
            <TableCell>
              {order.invoice_status ? (
                <InvoiceStatus status={order.invoice_status} />
              ) : (
                t('Available')
              )}
            </TableCell>
          </TableRow>
        ))}
        {props.eligibility.pending_refunds.map((refund) => (
          <TableRow key={`refund-${refund.id}`}>
            <TableCell>
              <Checkbox checked disabled aria-label={t('Mandatory refund')} />
            </TableCell>
            <TableCell>{t('Refund adjustment')}</TableCell>
            <TableCell className='tabular-nums'>
              {formatInvoiceTime(refund.created_at)}
            </TableCell>
            <TableCell className='text-destructive tabular-nums'>
              -{formatInvoiceAmount(refund.amount)}
            </TableCell>
            <TableCell>{t('Mandatory')}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </StaticDataTable>
  )
}
