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

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getInvoiceEligibility, getUserInvoices } from '@/features/invoices/api'
import { InvoiceHistory } from '@/features/invoices/components/invoice-history'
import { InvoiceOrdersTable } from '@/features/invoices/components/invoice-orders-table'
import { UserInvoiceForm } from '@/features/invoices/components/user-invoice-form'

interface UserInvoiceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserInvoiceDialog(props: UserInvoiceDialogProps) {
  const { t } = useTranslation()
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [showHistory, setShowHistory] = useState(false)
  const eligibility = useQuery({
    queryKey: ['invoice-eligibility'],
    queryFn: async () => {
      const response = await getInvoiceEligibility()
      if (!response.success) throw new Error(response.message)
      return response.data
    },
    enabled: props.open,
  })
  const applications = useQuery({
    queryKey: ['user-invoices'],
    queryFn: async () => {
      const response = await getUserInvoices()
      if (!response.success) throw new Error(response.message)
      return response.data
    },
    enabled: props.open,
  })

  let formContent = <Skeleton className='h-64 w-full rounded-lg' />
  if (eligibility.data) {
    formContent = (
      <UserInvoiceForm
        eligibility={eligibility.data}
        selectedIds={selectedIds}
        onSubmitted={() => setSelectedIds(new Set())}
      />
    )
  } else if (eligibility.isError) {
    formContent = <ErrorState onRetry={() => void eligibility.refetch()} />
  }

  const activeQuery = showHistory ? applications : eligibility
  let listContent = <Skeleton className='h-48 w-full rounded-lg' />
  if (showHistory && applications.data) {
    listContent = (
      <InvoiceHistory applications={applications.data.items || []} />
    )
  } else if (!showHistory && eligibility.data) {
    listContent = (
      <InvoiceOrdersTable
        eligibility={eligibility.data}
        selectedIds={selectedIds}
        onToggleOrder={(id, checked) =>
          setSelectedIds((current) => {
            const next = new Set(current)
            if (checked) next.add(id)
            else next.delete(id)
            return next
          })
        }
      />
    )
  } else if (activeQuery.isError) {
    listContent = <ErrorState onRetry={() => void activeQuery.refetch()} />
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Invoice application')}
      description={
        <span className='space-y-1'>
          <span className='block'>
            {t('The net invoice amount must be greater than 500.')}
          </span>
          <span className='block'>
            {t('Invoices are issued uniformly at the end of each month.')}
          </span>
        </span>
      }
      contentClassName='flex max-h-(--dialog-available-height) flex-col max-sm:w-screen max-sm:max-w-none max-sm:rounded-none max-sm:p-4 sm:max-w-5xl'
      contentHeight='auto'
      bodyClassName='space-y-5'
    >
      <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <div
          className='grid grid-cols-2 gap-2 sm:flex'
          role='group'
          aria-label={t('Invoice application')}
        >
          <Button
            type='button'
            size='sm'
            variant={showHistory ? 'outline' : 'default'}
            aria-pressed={!showHistory}
            aria-controls='invoice-list'
            onClick={() => setShowHistory(false)}
          >
            {t('Invoice orders')}
          </Button>
          <Button
            type='button'
            size='sm'
            variant={showHistory ? 'default' : 'outline'}
            aria-pressed={showHistory}
            aria-controls='invoice-list'
            onClick={() => setShowHistory(true)}
          >
            {t('Invoice records')}
          </Button>
        </div>
        {!showHistory && (
          <p className='text-muted-foreground text-sm' aria-live='polite'>
            {t('Selected {{count}}', { count: selectedIds.size })}
          </p>
        )}
      </div>

      <section aria-labelledby='invoice-form-title' className='space-y-4'>
        <h3 id='invoice-form-title' className='text-sm font-semibold'>
          {t('New invoice application')}
        </h3>
        {formContent}
      </section>

      <section
        id='invoice-list'
        aria-labelledby='invoice-list-title'
        className='min-w-0 space-y-3 border-t pt-4'
      >
        <h3 id='invoice-list-title' className='text-sm font-semibold'>
          {showHistory ? t('Invoice records') : t('Invoice orders')}
        </h3>
        {listContent}
      </section>
    </Dialog>
  )
}
