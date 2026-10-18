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
import { Download, RotateCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

import { fetchInvoicePDF, getInvoicePDFFileName } from '../api'
import { saveInvoicePDF } from '../lib/pdf'
import type { InvoiceApplication, InvoiceFileScope } from '../types'

type InvoicePdfPreviewDialogProps = {
  application: InvoiceApplication
  scope: InvoiceFileScope
  onOpenChange: (open: boolean) => void
}

export function InvoicePdfPreviewDialog(props: InvoicePdfPreviewDialogProps) {
  const { t } = useTranslation()
  const fileName = getInvoicePDFFileName(props.application)
  const pdf = useQuery({
    queryKey: ['invoice-pdf', props.scope, props.application.id],
    queryFn: ({ signal }) =>
      fetchInvoicePDF(props.application.id, props.scope, signal),
    // Invoice bytes should not outlive the dialog in the query cache.
    gcTime: 0,
    staleTime: 0,
    retry: false,
    meta: { errorToast: false },
  })
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(
    null
  )
  useEffect(() => {
    if (!pdf.data) return
    const url = URL.createObjectURL(pdf.data)
    setPreview({ blob: pdf.data, url })
    return () => URL.revokeObjectURL(url)
  }, [pdf.data])
  const previewUrl = preview?.blob === pdf.data ? preview?.url : undefined

  let body: React.ReactNode
  if (pdf.isError) {
    body = (
      <div
        role='alert'
        className='flex h-full flex-col items-center justify-center gap-3 text-center'
      >
        <p className='text-sm'>
          {pdf.error.message || t('Failed to load invoice PDF')}
        </p>
        <Button variant='outline' size='sm' onClick={() => pdf.refetch()}>
          <RotateCw data-icon='inline-start' aria-hidden='true' />
          {t('Retry')}
        </Button>
      </div>
    )
  } else if (previewUrl) {
    // The Blob is verified to start with the PDF signature and is typed as
    // application/pdf. <object> uses the browser PDF viewer, which sandboxed
    // iframes block in Chromium, and shows the fallback when none exists.
    body = (
      <object
        data={previewUrl}
        type='application/pdf'
        aria-label={t('Invoice PDF preview')}
        className='h-full w-full rounded-md border'
      >
        <p className='p-4 text-sm'>
          {t(
            'This browser cannot preview PDF files. Download the file instead.'
          )}
        </p>
      </object>
    )
  } else {
    body = (
      <div
        role='status'
        className='text-muted-foreground flex h-full items-center justify-center gap-2 text-sm'
      >
        <Spinner />
        {t('Loading invoice PDF...')}
      </div>
    )
  }

  return (
    <Dialog
      open
      onOpenChange={props.onOpenChange}
      title={t('Invoice PDF preview')}
      description={fileName}
      contentClassName='sm:max-w-5xl'
      contentHeight='70vh'
      bodyClassName='h-full'
      footer={
        <>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Close')}
          </Button>
          <Button
            disabled={!pdf.data}
            onClick={() => {
              if (pdf.data) saveInvoicePDF(pdf.data, fileName)
            }}
          >
            <Download data-icon='inline-start' aria-hidden='true' />
            {t('Download PDF')}
          </Button>
        </>
      }
    >
      {body}
    </Dialog>
  )
}
