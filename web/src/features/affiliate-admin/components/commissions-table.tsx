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
import type { ColumnDef, PaginationState } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { formatQuota } from '@/lib/format'

import type { AffiliateAnalyticsCommission } from '../api'

type CommissionsTableProps = {
  data: AffiliateAnalyticsCommission[]
  total: number
  pagination: PaginationState
  onPaginationChange: (pagination: PaginationState) => void
  isLoading: boolean
  isFetching: boolean
}

const STATUS_LABEL_KEYS: Record<
  AffiliateAnalyticsCommission['status'],
  string
> = {
  completed: 'Completed',
  pending: 'Pending',
  failed: 'Failed',
}

function formatTimestamp(seconds: number): string {
  if (!seconds) return '-'
  return new Date(seconds * 1000).toLocaleString()
}

export function CommissionsTable(props: CommissionsTableProps) {
  const { t } = useTranslation()
  const columns = useMemo<ColumnDef<AffiliateAnalyticsCommission, unknown>[]>(
    () => [
      {
        accessorKey: 'created_at',
        header: t('Time'),
        cell: ({ row }) => formatTimestamp(row.original.created_at),
      },
      {
        accessorKey: 'inviter_name',
        header: t('Inviter'),
        cell: ({ row }) =>
          row.original.inviter_name || `#${row.original.inviter_id}`,
      },
      {
        accessorKey: 'invitee_name',
        header: t('Invited user'),
        cell: ({ row }) =>
          row.original.invitee_name || `#${row.original.invitee_id}`,
      },
      {
        accessorKey: 'model_name',
        header: t('Model'),
        cell: ({ row }) => row.original.model_name || '-',
      },
      {
        accessorKey: 'consumed_quota',
        header: t('Consumed'),
        cell: ({ row }) => formatQuota(row.original.consumed_quota),
      },
      {
        accessorKey: 'credited_quota',
        header: t('Credited quota'),
        cell: ({ row }) => formatQuota(row.original.credited_quota),
      },
      {
        accessorKey: 'status',
        header: t('Status'),
        cell: ({ row }) => (
          <Badge variant='secondary'>
            {t(STATUS_LABEL_KEYS[row.original.status] ?? row.original.status)}
          </Badge>
        ),
      },
    ],
    [t]
  )
  const { table } = useDataTable({
    data: props.data,
    columns,
    pagination: props.pagination,
    onPaginationChange: (updater) => {
      props.onPaginationChange(
        typeof updater === 'function' ? updater(props.pagination) : updater
      )
    },
    manualPagination: true,
    totalCount: props.total,
    getRowId: (row) => String(row.id),
  })

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={props.isLoading}
      isFetching={props.isFetching}
      emptyTitle={t('No commission records found')}
      emptyDescription={t(
        'Try changing the date range, search, or status filter.'
      )}
      toolbarProps={null}
      hideMobile
      paginationInFooter={false}
    />
  )
}
