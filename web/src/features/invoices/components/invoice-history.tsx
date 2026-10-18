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
import { useMutation } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { downloadInvoicePDF } from '../api'
import { formatInvoiceAmount, formatInvoiceTime } from '../lib'
import type { InvoiceApplication } from '../types'
import { InvoiceStatusDetails } from './invoice-status-details'

export function InvoiceHistory(props: { applications: InvoiceApplication[] }) {
  const { t } = useTranslation()
  const download = useMutation({
    mutationFn: (application: InvoiceApplication) =>
      downloadInvoicePDF(application, 'self'),
    onError: (error) =>
      toast.error(error.message || t('Failed to download invoice PDF')),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Invoice records')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className='overflow-hidden rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Application ID')}</TableHead>
                <TableHead>{t('Invoice title')}</TableHead>
                <TableHead>{t('Net invoice amount')}</TableHead>
                <TableHead>{t('Refund deduction')}</TableHead>
                <TableHead>{t('Applied at')}</TableHead>
                <TableHead>{t('Status')}</TableHead>
                <TableHead className='text-right'>{t('Actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.applications.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className='text-center'>
                    {t('No invoice applications')}
                  </TableCell>
                </TableRow>
              )}
              {props.applications.map((application) => {
                const refundItems = application.items.filter(
                  (item) => item.type === 'refund'
                )
                return (
                  <TableRow key={application.id}>
                    <TableCell className='tabular-nums'>
                      #{application.id}
                    </TableCell>
                    <TableCell>{application.title}</TableCell>
                    <TableCell className='tabular-nums'>
                      {formatInvoiceAmount(application.net_amount)}
                    </TableCell>
                    <TableCell>
                      {refundItems.length > 0 ? (
                        <div className='flex flex-col gap-1'>
                          {refundItems.map((item) => (
                            <div key={item.id} className='text-sm'>
                              <div className='tabular-nums'>
                                {formatInvoiceAmount(item.amount)}
                              </div>
                              <div className='text-muted-foreground text-xs'>
                                {formatInvoiceTime(item.occurred_at)}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        '-'
                      )}
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
                      {application.status === 'issued' &&
                      application.file_name ? (
                        <Button
                          variant='outline'
                          size='sm'
                          disabled={download.isPending}
                          onClick={() => download.mutate(application)}
                        >
                          <Download
                            data-icon='inline-start'
                            aria-hidden='true'
                          />
                          {t('Download')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
