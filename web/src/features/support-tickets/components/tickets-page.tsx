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
import { Plus, Search } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTableUrlState, type NavigateFn } from '@/hooks/use-table-url-state'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getSupportTickets } from '../api'
import type {
  SupportTicket,
  SupportTicketListFilters,
  SupportTicketScope,
  SupportTicketStatus,
} from '../types'
import { CreateTicketDialog } from './create-ticket-dialog'
import { TicketDetailDialog } from './ticket-detail-dialog'
import { useTicketColumns } from './use-ticket-columns'

type TicketSearch = Record<string, unknown> & {
  page?: number
  pageSize?: number
  status?: SupportTicketStatus[]
  username?: string
  request_id?: string
}

export function TicketsPage(props: {
  scope: SupportTicketScope
  search: TicketSearch
  navigate: NavigateFn
}) {
  const { t } = useTranslation()
  const admin = props.scope === 'admin'
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<SupportTicket | null>(null)
  const [username, setUsername] = useState(props.search.username ?? '')
  const [requestId, setRequestId] = useState(props.search.request_id ?? '')
  const {
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: props.search,
    navigate: props.navigate,
    pagination: { defaultPage: 1, defaultPageSize: 20 },
    globalFilter: { enabled: false },
    columnFilters: [{ columnId: 'status', searchKey: 'status', type: 'array' }],
  })
  const status = columnFilters.find((filter) => filter.id === 'status')
    ?.value as SupportTicketStatus[] | undefined
  const filters: SupportTicketListFilters = {
    status: status?.[0] ?? '',
    username: props.search.username ?? '',
    request_id: props.search.request_id ?? '',
  }
  const tickets = useQuery({
    queryKey: [
      'support-tickets',
      props.scope,
      filters,
      pagination.pageIndex + 1,
      pagination.pageSize,
    ],
    queryFn: async ({ signal }) => {
      const response = requireServerSuccess(
        await getSupportTickets(
          props.scope,
          filters,
          pagination.pageIndex + 1,
          pagination.pageSize,
          signal
        )
      )
      return {
        items: response.data.items || [],
        total: response.data.total || 0,
      }
    },
    placeholderData: (previous) => previous,
    meta: { errorToast: false },
  })
  const onView = useCallback((ticket: SupportTicket) => setSelected(ticket), [])
  const columns = useTicketColumns({ admin, onView })
  const { table } = useDataTable({
    data: tickets.data?.items ?? [],
    columns,
    columnFilters,
    pagination,
    onColumnFiltersChange,
    onPaginationChange,
    manualPagination: true,
    manualFiltering: true,
    totalCount: tickets.data?.total ?? 0,
    ensurePageInRange,
    getRowId: (row) => String(row.id),
  })
  const applySearch = (next: { username?: string; request_id?: string }) => {
    props.navigate({
      search: (previous) => ({
        ...previous,
        page: undefined,
        ...next,
      }),
    })
  }

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {admin ? t('Support ticket management') : t('Support tickets')}
        </SectionPageLayout.Title>
        {!admin ? (
          <SectionPageLayout.Actions>
            <Button onClick={() => setCreating(true)}>
              <Plus data-icon='inline-start' aria-hidden='true' />
              {t('New support ticket')}
            </Button>
          </SectionPageLayout.Actions>
        ) : null}
        <SectionPageLayout.Content>
          {tickets.isError ? (
            <ErrorState
              title={t('Failed to load support tickets')}
              onRetry={() => tickets.refetch()}
            />
          ) : (
            <DataTablePage
              table={table}
              columns={columns}
              isLoading={tickets.isLoading}
              isFetching={tickets.isFetching}
              emptyTitle={t('No support tickets')}
              emptyDescription={
                admin
                  ? t('No tickets match the current filters.')
                  : t('Create a ticket to ask for help or share feedback.')
              }
              emptyAction={
                !admin ? (
                  <Button onClick={() => setCreating(true)}>
                    {t('New support ticket')}
                  </Button>
                ) : undefined
              }
              skeletonKeyPrefix={`${props.scope}-support-tickets`}
              toolbarProps={
                admin
                  ? {
                      customSearch: (
                        <div className='flex min-w-0 flex-wrap items-center gap-2'>
                          <form
                            role='search'
                            aria-label={t('Search by username')}
                            className='flex gap-2'
                            onSubmit={(event) => {
                              event.preventDefault()
                              applySearch({
                                username: username.trim() || undefined,
                              })
                            }}
                          >
                            <Input
                              value={username}
                              aria-label={t('Username')}
                              placeholder={t('Filter by username')}
                              className='w-48'
                              onChange={(event) =>
                                setUsername(event.target.value)
                              }
                            />
                            <Button type='submit' variant='outline' size='icon'>
                              <Search aria-hidden='true' />
                              <span className='sr-only'>{t('Search')}</span>
                            </Button>
                          </form>
                          <form
                            role='search'
                            aria-label={t('Search by request ID')}
                            className='flex gap-2'
                            onSubmit={(event) => {
                              event.preventDefault()
                              applySearch({
                                request_id: requestId.trim() || undefined,
                              })
                            }}
                          >
                            <Input
                              value={requestId}
                              aria-label={t('Request ID')}
                              placeholder={t('Filter by request ID')}
                              className='w-56'
                              onChange={(event) =>
                                setRequestId(event.target.value)
                              }
                            />
                            <Button type='submit' variant='outline' size='icon'>
                              <Search aria-hidden='true' />
                              <span className='sr-only'>{t('Search')}</span>
                            </Button>
                          </form>
                        </div>
                      ),
                      filters: [
                        {
                          columnId: 'status',
                          title: t('Status'),
                          singleSelect: true,
                          options: [
                            { label: t('Pending'), value: 'pending' },
                            { label: t('Replied'), value: 'replied' },
                          ],
                        },
                      ],
                      hasAdditionalFilters: Boolean(
                        filters.username || filters.request_id
                      ),
                      onReset: () =>
                        applySearch({
                          username: undefined,
                          request_id: undefined,
                        }),
                      hideViewOptions: true,
                    }
                  : null
              }
            />
          )}
        </SectionPageLayout.Content>
      </SectionPageLayout>
      {!admin ? (
        <CreateTicketDialog
          open={creating}
          onOpenChange={setCreating}
          onCreated={(id) => setSelected({ id } as SupportTicket)}
        />
      ) : null}
      {selected ? (
        <TicketDetailDialog
          key={selected.id}
          id={selected.id}
          scope={props.scope}
          onOpenChange={(open) => {
            if (!open) setSelected(null)
          }}
        />
      ) : null}
    </>
  )
}
