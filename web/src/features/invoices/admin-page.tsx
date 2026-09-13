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
import { Download, FileUp, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import {
  getAdminInvoices,
  markInvoiceProcessing,
  rejectInvoice,
  uploadInvoicePDF,
} from './api'
import { InvoiceStatusDetails } from './components/invoice-status-details'
import { RejectInvoiceDialog } from './components/reject-invoice-dialog'
import { formatInvoiceAmount, formatInvoiceTime } from './lib'
import {
  buildInvoiceExportFilename,
  buildInvoiceExportWorkbook,
  collectInvoiceApplicationsForExport,
  InvoiceExportEmptyError,
  InvoiceExportLimitError,
} from './lib/export'
import type {
  InvoiceApplication,
  InvoiceStatus as InvoiceStatusType,
} from './types'

export function AdminInvoicePage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<InvoiceStatusType | ''>('')
  const [rejectingApplication, setRejectingApplication] =
    useState<InvoiceApplication | null>(null)
  const applications = useQuery({
    queryKey: ['admin-invoices', status],
    queryFn: async () => {
      const response = await getAdminInvoices(status)
      if (!response.success) throw new Error(response.message)
      return response.data
    },
  })

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['admin-invoices'] })

  const processing = useMutation({
    mutationFn: async (id: number) => {
      const response = await markInvoiceProcessing(id)
      if (!response.success) throw new Error(response.message)
    },
    onSuccess: async () => {
      await refresh()
      toast.success(t('Invoice marked as processing'))
    },
  })

  const upload = useMutation({
    mutationFn: async (input: { id: number; file: File }) => {
      const response = await uploadInvoicePDF(input.id, input.file)
      if (!response.success) throw new Error(response.message)
    },
    onSuccess: async () => {
      await refresh()
      toast.success(t('Invoice PDF uploaded'))
    },
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
    mutationFn: async (exportStatus: InvoiceStatusType | '') => {
      const [xlsx, exportApplications] = await Promise.all([
        import('xlsx'),
        collectInvoiceApplicationsForExport(exportStatus, getAdminInvoices),
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

  const handleFile = (application: InvoiceApplication, file?: File) => {
    if (!file) return
    if (
      file.type !== 'application/pdf' &&
      !file.name.toLowerCase().endsWith('.pdf')
    ) {
      toast.error(t('Please select a PDF file'))
      return
    }
    upload.mutate({ id: application.id, file })
  }

  return (
    <>
      <SectionPageLayout>
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
            onClick={() => exporting.mutate(status)}
          >
            {exporting.isPending ? (
              <Spinner data-icon='inline-start' />
            ) : (
              <Download data-icon='inline-start' aria-hidden='true' />
            )}
            {exporting.isPending ? t('Exporting...') : t('Export Excel')}
          </Button>
          <NativeSelect
            value={status}
            aria-label={t('Filter invoice status')}
            onChange={(event) =>
              setStatus(event.target.value as InvoiceStatusType | '')
            }
          >
            <NativeSelectOption value=''>
              {t('All statuses')}
            </NativeSelectOption>
            <NativeSelectOption value='applied'>
              {t('Applied')}
            </NativeSelectOption>
            <NativeSelectOption value='processing'>
              {t('Processing')}
            </NativeSelectOption>
            <NativeSelectOption value='issued'>
              {t('Issued')}
            </NativeSelectOption>
            <NativeSelectOption value='rejected'>
              {t('Rejected')}
            </NativeSelectOption>
          </NativeSelect>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <Card>
            <CardHeader>
              <CardTitle>{t('Invoice applications')}</CardTitle>
            </CardHeader>
            <CardContent>
              {applications.data ? (
                <div className='overflow-hidden rounded-lg border'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('User')}</TableHead>
                        <TableHead>{t('Invoice information')}</TableHead>
                        <TableHead>{t('Orders')}</TableHead>
                        <TableHead>{t('Order amount')}</TableHead>
                        <TableHead>{t('Refund deduction')}</TableHead>
                        <TableHead>{t('Net invoice amount')}</TableHead>
                        <TableHead>{t('Applied at')}</TableHead>
                        <TableHead>{t('Status')}</TableHead>
                        <TableHead className='text-right'>
                          {t('Actions')}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(applications.data.items || []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={9} className='text-center'>
                            {t('No invoice applications')}
                          </TableCell>
                        </TableRow>
                      )}
                      {(applications.data.items || []).map((application) => {
                        const orderNumbers = application.items
                          .filter((item) => item.type === 'order')
                          .map((item) => item.trade_no)
                          .filter(Boolean)
                          .join(', ')
                        return (
                          <TableRow key={application.id}>
                            <TableCell>
                              <div className='font-medium'>
                                {application.username || '-'}
                              </div>
                              <div className='text-muted-foreground text-xs tabular-nums'>
                                ID: {application.user_id}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className='font-medium'>
                                {application.title}
                              </div>
                              <div className='text-muted-foreground text-xs'>
                                {application.tax_id}
                              </div>
                            </TableCell>
                            <TableCell
                              className='max-w-64 truncate'
                              title={orderNumbers}
                            >
                              {orderNumbers || '-'}
                            </TableCell>
                            <TableCell className='tabular-nums'>
                              {formatInvoiceAmount(application.gross_amount)}
                            </TableCell>
                            <TableCell className='tabular-nums'>
                              -{formatInvoiceAmount(application.refund_amount)}
                            </TableCell>
                            <TableCell className='font-medium tabular-nums'>
                              {formatInvoiceAmount(application.net_amount)}
                            </TableCell>
                            <TableCell className='tabular-nums'>
                              {formatInvoiceTime(application.created_at)}
                            </TableCell>
                            <TableCell>
                              <InvoiceStatusDetails
                                status={application.status}
                                rejectReason={application.reject_reason}
                              />
                            </TableCell>
                            <TableCell className='text-right'>
                              <div className='flex justify-end gap-2'>
                                {application.status === 'applied' ? (
                                  <Button
                                    size='sm'
                                    variant='outline'
                                    disabled={processing.isPending}
                                    onClick={() =>
                                      processing.mutate(application.id)
                                    }
                                  >
                                    {t('Start processing')}
                                  </Button>
                                ) : null}
                                {application.status === 'processing' ? (
                                  <label className='inline-flex'>
                                    <Input
                                      type='file'
                                      accept='application/pdf,.pdf'
                                      className='sr-only'
                                      disabled={upload.isPending}
                                      onChange={(event) => {
                                        handleFile(
                                          application,
                                          event.target.files?.[0]
                                        )
                                        event.target.value = ''
                                      }}
                                    />
                                    <Button
                                      size='sm'
                                      variant='outline'
                                      render={<span />}
                                      nativeButton={false}
                                      disabled={upload.isPending}
                                    >
                                      <FileUp
                                        data-icon='inline-start'
                                        aria-hidden='true'
                                      />
                                      {t('Upload PDF')}
                                    </Button>
                                  </label>
                                ) : null}
                                {application.status === 'applied' ||
                                application.status === 'processing' ? (
                                  <Button
                                    size='sm'
                                    variant='destructive'
                                    disabled={reject.isPending}
                                    onClick={() =>
                                      setRejectingApplication(application)
                                    }
                                  >
                                    <XCircle
                                      data-icon='inline-start'
                                      aria-hidden='true'
                                    />
                                    {t('Reject')}
                                  </Button>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <Skeleton className='h-96 w-full rounded-lg' />
              )}
            </CardContent>
          </Card>
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
    </>
  )
}
