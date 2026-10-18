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
import { Download, Eye, FileUp, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import type { InvoiceApplication } from '../types'

export type AdminInvoiceRowActionHandlers = {
  pendingProcessingId?: number
  pendingUploadId?: number
  pendingDownloadId?: number
  onStartProcessing: (application: InvoiceApplication) => void
  onUpload: (application: InvoiceApplication, file?: File) => void
  onReject: (application: InvoiceApplication) => void
  onPreview: (application: InvoiceApplication) => void
  onDownload: (application: InvoiceApplication) => void
}

export function AdminInvoiceRowActions(
  props: AdminInvoiceRowActionHandlers & { application: InvoiceApplication }
) {
  const { t } = useTranslation()
  const application = props.application
  const hasFile = application.status === 'issued' && !!application.file_name
  const uploading = props.pendingUploadId === application.id

  return (
    <div className='flex flex-wrap justify-end gap-2'>
      {application.status === 'applied' ? (
        <Button
          size='sm'
          variant='outline'
          disabled={props.pendingProcessingId === application.id}
          onClick={() => props.onStartProcessing(application)}
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
            disabled={uploading}
            onChange={(event) => {
              props.onUpload(application, event.target.files?.[0])
              event.target.value = ''
            }}
          />
          <Button
            size='sm'
            variant='outline'
            render={<span />}
            nativeButton={false}
            disabled={uploading}
          >
            <FileUp data-icon='inline-start' aria-hidden='true' />
            {t('Upload PDF')}
          </Button>
        </label>
      ) : null}
      {hasFile ? (
        <>
          <Button
            size='sm'
            variant='outline'
            onClick={() => props.onPreview(application)}
          >
            <Eye data-icon='inline-start' aria-hidden='true' />
            {t('Preview PDF')}
          </Button>
          <Button
            size='sm'
            variant='outline'
            disabled={props.pendingDownloadId === application.id}
            onClick={() => props.onDownload(application)}
          >
            <Download data-icon='inline-start' aria-hidden='true' />
            {t('Download PDF')}
          </Button>
        </>
      ) : null}
      {application.status === 'applied' ||
      application.status === 'processing' ? (
        <Button
          size='sm'
          variant='destructive'
          onClick={() => props.onReject(application)}
        >
          <XCircle data-icon='inline-start' aria-hidden='true' />
          {t('Reject')}
        </Button>
      ) : null}
    </div>
  )
}
