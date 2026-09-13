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
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Skeleton } from '@/components/ui/skeleton'

import { getInvoiceEligibility, getUserInvoices } from './api'
import { InvoiceHistory } from './components/invoice-history'
import { UserInvoiceForm } from './components/user-invoice-form'

export function UserInvoicePage() {
  const { t } = useTranslation()
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

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Invoice application')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          {eligibility.data ? (
            <UserInvoiceForm eligibility={eligibility.data} />
          ) : (
            <Skeleton className='h-96 w-full rounded-lg' />
          )}
          {applications.data ? (
            <InvoiceHistory applications={applications.data.items || []} />
          ) : (
            <Skeleton className='h-64 w-full rounded-lg' />
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
