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

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import { getInvoiceEligibility, getUserInvoices } from './api'
import { InvoiceHistory } from './components/invoice-history'
import { InvoiceOrdersTable } from './components/invoice-orders-table'
import { UserInvoiceForm } from './components/user-invoice-form'

export function UserInvoicePage() {
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
  })
  const applications = useQuery({
    queryKey: ['user-invoices'],
    queryFn: async () => {
      const response = await getUserInvoices()
      if (!response.success) throw new Error(response.message)
      return response.data
    },
  })
  let formContent = <Skeleton className='h-96 w-full rounded-lg' />
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
  let listContent = <Skeleton className='h-64 w-full rounded-lg' />
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
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>
        {t('Invoice application')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='grid h-full min-h-0 grid-rows-2 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-rows-1'>
          <section
            aria-label={t('New invoice application')}
            tabIndex={0}
            className='min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain'
          >
            {formContent}
          </section>
          <Card className='min-h-0 min-w-0'>
            <CardHeader className='shrink-0'>
              <CardTitle>
                {showHistory ? t('Invoice records') : t('Invoice orders')}
              </CardTitle>
              <div className='flex flex-wrap gap-2'>
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
            </CardHeader>
            <CardContent
              id='invoice-list'
              role='region'
              aria-label={
                showHistory ? t('Invoice records') : t('Invoice orders')
              }
              tabIndex={0}
              className='min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain'
            >
              {listContent}
            </CardContent>
          </Card>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
