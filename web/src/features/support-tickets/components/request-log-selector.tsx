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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { getUserLogs } from '@/features/usage-logs/api'
import type { UsageLog } from '@/features/usage-logs/data/schema'
import { requireServerSuccess } from '@/lib/server-error-message'

import { formatSupportTicketTime } from '../lib/format'

export function RequestLogSelector(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (requestId: string) => void
}) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const pageSize = 10
  const logs = useQuery({
    queryKey: ['support-ticket-request-logs', page],
    queryFn: async () => {
      const response = await getUserLogs({ p: page, page_size: pageSize })
      const data = requireServerSuccess(response).data
      return {
        items: (data?.items ?? []) as UsageLog[],
        total: data?.total ?? 0,
      }
    },
    enabled: props.open,
    placeholderData: (previous) => previous,
    meta: { errorToast: false },
  })
  const pageCount = Math.max(1, Math.ceil((logs.data?.total ?? 0) / pageSize))

  let content: React.ReactNode
  if (logs.isLoading) {
    content = <LoadingState message={t('Loading request logs...')} />
  } else if (logs.isError) {
    content = (
      <ErrorState
        title={t('Failed to load request logs')}
        onRetry={() => logs.refetch()}
      />
    )
  } else {
    content = (
      <StaticDataTable<UsageLog>
        data={logs.data?.items ?? []}
        getRowKey={(row) => row.id}
        emptyContent={<EmptyState title={t('No request logs available')} />}
        columns={[
          {
            id: 'request_id',
            header: t('Request ID'),
            cell: (row) => row.request_id || '-',
          },
          {
            id: 'created_at',
            header: t('Time'),
            cell: (row) => formatSupportTicketTime(row.created_at),
          },
          {
            id: 'model_name',
            header: t('Model'),
            cell: (row) => row.model_name || '-',
          },
          {
            id: 'actions',
            header: <span className='sr-only'>{t('Actions')}</span>,
            cellClassName: 'text-right',
            cell: (row) => (
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={!row.request_id}
                onClick={() => {
                  props.onSelect(row.request_id)
                  props.onOpenChange(false)
                }}
              >
                {t('Select')}
              </Button>
            ),
          },
        ]}
      />
    )
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Select a request log')}
      description={t('Only your own recent request logs are shown.')}
      contentClassName='sm:max-w-4xl'
      footer={
        <div className='flex w-full items-center justify-between gap-2'>
          <span className='text-muted-foreground text-sm'>
            {t('Page {{page}} of {{total}}', { page, total: pageCount })}
          </span>
          <div className='flex gap-2'>
            <Button
              type='button'
              variant='outline'
              disabled={page <= 1 || logs.isFetching}
              onClick={() => setPage((value) => value - 1)}
            >
              {t('Previous')}
            </Button>
            <Button
              type='button'
              variant='outline'
              disabled={page >= pageCount || logs.isFetching}
              onClick={() => setPage((value) => value + 1)}
            >
              {t('Next')}
            </Button>
          </div>
        </div>
      }
    >
      {content}
    </Dialog>
  )
}
