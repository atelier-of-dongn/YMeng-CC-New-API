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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  downloadInvoicePDF,
  getAdminInvoices,
  markInvoiceProcessing,
  rejectInvoice,
  uploadInvoicePDF,
} from './api'
import { useAdminInvoiceColumns } from './components/admin-invoice-columns'
import type { AdminInvoiceRowActionHandlers } from './components/admin-invoice-row-actions'
import { InvoicePdfPreviewDialog } from './components/invoice-pdf-preview-dialog'
import { InvoiceSearchBar } from './components/invoice-search-bar'
import { RejectInvoiceDialog } from './components/reject-invoice-dialog'
import {
  buildInvoiceExportFilename,
  buildInvoiceExportWorkbook,
  collectInvoiceApplicationsForExport,
  InvoiceExportEmptyError,
  InvoiceExportLimitError,
} from './lib/export'
import { DEFAULT_INVOICE_SEARCH_FIELD } from './lib/filters'
import type {
  InvoiceApplication,
  InvoiceListFilters,
  InvoiceSearchField,
  InvoiceStatus,
} from './types'

const route = getRouteApi('/_authenticated/admin-invoices/')

export function AdminInvoicePage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const [rejectingApplication, setRejectingApplication] =
    useState<InvoiceApplication | null>(null)
  const [previewApplication, setPreviewApplication] =
    useState<InvoiceApplication | null>(null)

  const {
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search,
    navigate,
    pagination: { defaultPage: 1, defaultPageSize: 20 },
    globalFilter: { enabled: false },
    columnFilters: [{ columnId: 'status', searchKey: 'status', type: 'array' }],
  })
  const statusFilter = columnFilters.find((filter) => filter.id === 'status')
    ?.value as InvoiceStatus[] | undefined
  const filters = useMemo(
    (): InvoiceListFilters => ({
      status: statusFilter?.[0] ?? '',
      searchField: search.searchField ?? DEFAULT_INVOICE_SEARCH_FIELD,
      keyword: search.keyword ?? '',
    }),
    [search.keyword, search.searchField, statusFilter]
  )

  const applications = useQuery({
    queryKey: [
      'admin-invoices',
      filters,
      pagination.pageIndex + 1,
      pagination.pageSize,
    ],
    queryFn: async ({ signal }) => {
      const response = requireServerSuccess(
        await getAdminInvoices(
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
  })

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['admin-invoices'] })

  const processing = useMutation({
    mutationFn: async (id: number) => {
      requireServerSuccess(await markInvoiceProcessing(id))
    },
    onSuccess: async () => {
      await refresh()
      toast.success(t('Invoice marked as processing'))
    },
  })

  const upload = useMutation({
    mutationFn: async (input: { id: number; file: File }) => {
      requireServerSuccess(await uploadInvoicePDF(input.id, input.file))
    },
    onSuccess: async () => {
      await refresh()
      toast.success(t('Invoice PDF uploaded'))
    },
  })

  const download = useMutation({
    mutationFn: (application: InvoiceApplication) =>
      downloadInvoicePDF(application, 'admin'),
    onError: (error) =>
      toast.error(error.message || t('Failed to download invoice PDF')),
  })

  const reject = useMutation({
    mutationFn: async (input: { id: number; reason: string }) => {
      const response = await rejectInvoice(input.id, input.reason)
      if (!response.success) throw new Error(response.message)
    },
    onSuccess: async () => {
      setRejectingApplication(null)
      await refresh()
      toast.success(t('Invoice application rejected'))
    },
    onError: (error) => {
      const responseMessage = (
        error as { response?: { data?: { message?: string } } }
      ).response?.data?.message
      toast.error(
        responseMessage ||
          (error instanceof Error ? error.message : t('Request failed'))
      )
    },
  })

  const exporting = useMutation({
    mutationFn: async (exportFilters: InvoiceListFilters) => {
      const [xlsx, exportApplications] = await Promise.all([
        import('xlsx'),
        collectInvoiceApplicationsForExport(exportFilters, getAdminInvoices),
      ])
      if (exportApplications.length === 0) {
        throw new InvoiceExportEmptyError()
      }
      const workbook = buildInvoiceExportWorkbook(exportApplications, t, xlsx)
      xlsx.writeFileXLSX(workbook, buildInvoiceExportFilename(), {
        compression: true,
      })
    },
    onSuccess: () => toast.success(t('Invoice applications exported')),
    onError: (error) => {
      if (error instanceof InvoiceExportLimitError) {
        toast.error(t('Too many invoice applications to export'))
        return
      }
      if (error instanceof InvoiceExportEmptyError) {
        toast.error(t('No invoice applications to export'))
        return
      }
      toast.error(t('Failed to export invoice applications'))
    },
  })

  const rowActions = useMemo(
    (): AdminInvoiceRowActionHandlers => ({
      pendingProcessingId: processing.isPending
        ? processing.variables
        : undefined,
      pendingUploadId: upload.isPending ? upload.variables?.id : undefined,
      pendingDownloadId: download.isPending
        ? download.variables?.id
        : undefined,
      onStartProcessing: (application) => processing.mutate(application.id),
      onUpload: (application, file) => {
        if (!file) return
        if (
          file.type !== 'application/pdf' &&
          !file.name.toLowerCase().endsWith('.pdf')
        ) {
          toast.error(t('Please select a PDF file'))
          return
        }
        upload.mutate({ id: application.id, file })
      },
      onReject: setRejectingApplication,
      onPreview: setPreviewApplication,
      onDownload: (application) => download.mutate(application),
    }),
    [download, processing, t, upload]
  )
  const columns = useAdminInvoiceColumns(rowActions)

  const { table } = useDataTable({
    data: applications.data?.items ?? [],
    columns,
    columnFilters,
    pagination,
    onColumnFiltersChange,
    onPaginationChange,
    manualPagination: true,
    manualFiltering: true,
    totalCount: applications.data?.total ?? 0,
    ensurePageInRange,
    getRowId: (row) => String(row.id),
  })

  const handleSearch = (searchField: InvoiceSearchField, keyword: string) => {
    navigate({
      search: (previous) => ({
        ...previous,
        page: undefined,
        searchField: keyword ? searchField : undefined,
        keyword: keyword || undefined,
      }),
    })
  }

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('Invoice management')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button
            variant='outline'
            disabled={
              exporting.isPending ||
              !applications.data ||
              applications.data.total === 0
            }
            onClick={() => exporting.mutate(filters)}
          >
            {exporting.isPending ? (
              <Spinner data-icon='inline-start' />
            ) : (
              <Download data-icon='inline-start' aria-hidden='true' />
            )}
            {exporting.isPending ? t('Exporting...') : t('Export Excel')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <DataTablePage
            table={table}
            columns={columns}
            isLoading={applications.isLoading}
            isFetching={applications.isFetching}
            emptyTitle={t('No invoice applications')}
            emptyDescription={t(
              'No invoice applications match the current search.'
            )}
            skeletonKeyPrefix='admin-invoices-skeleton'
            toolbarProps={{
              customSearch: (
                <InvoiceSearchBar
                  key={`${filters.searchField}:${filters.keyword}`}
                  field={filters.searchField}
                  keyword={filters.keyword}
                  onSearch={handleSearch}
                />
              ),
              filters: [
                {
                  columnId: 'status',
                  title: t('Status'),
                  singleSelect: true,
                  options: [
                    { label: t('Applied'), value: 'applied' },
                    { label: t('Processing'), value: 'processing' },
                    { label: t('Issued'), value: 'issued' },
                    { label: t('Rejected'), value: 'rejected' },
                  ],
                },
              ],
              hasAdditionalFilters: filters.keyword !== '',
              onReset: () => handleSearch(filters.searchField, ''),
              hideViewOptions: true,
            }}
          />
        </SectionPageLayout.Content>
      </SectionPageLayout>
      {rejectingApplication ? (
        <RejectInvoiceDialog
          open
          pending={reject.isPending}
          onOpenChange={(open) => {
            if (!open) setRejectingApplication(null)
          }}
          onReject={(reason) =>
            reject.mutate({ id: rejectingApplication.id, reason })
          }
        />
      ) : null}
      {previewApplication ? (
        <InvoicePdfPreviewDialog
          key={previewApplication.id}
          application={previewApplication}
          scope='admin'
          onOpenChange={(open) => {
            if (!open) setPreviewApplication(null)
          }}
        />
      ) : null}
    </>
  )
}
