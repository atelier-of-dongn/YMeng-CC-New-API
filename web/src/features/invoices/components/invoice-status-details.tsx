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
import { useTranslation } from 'react-i18next'

import type { InvoiceStatus as InvoiceStatusType } from '../types'
import { InvoiceStatus } from './invoice-status'

export function InvoiceStatusDetails(props: {
  status: InvoiceStatusType
  rejectReason?: string
}) {
  const { t } = useTranslation()
  return (
    <div className='flex max-w-64 flex-col items-start gap-2'>
      <InvoiceStatus status={props.status} />
      {props.status === 'rejected' && props.rejectReason ? (
        <p className='text-muted-foreground text-xs wrap-anywhere whitespace-pre-wrap'>
          <span className='text-foreground font-medium'>
            {t('Rejection reason')}:
          </span>{' '}
          {props.rejectReason}
        </p>
      ) : null}
    </div>
  )
}
