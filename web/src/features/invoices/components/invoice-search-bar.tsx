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
import { Search } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import {
  INVOICE_SEARCH_FIELD_LABELS,
  INVOICE_SEARCH_FIELDS,
  getInvoiceSearchError,
  isInvoiceAmountSearchField,
} from '../lib/filters'
import type { InvoiceSearchField } from '../types'

type InvoiceSearchBarProps = {
  field: InvoiceSearchField
  keyword: string
  onSearch: (field: InvoiceSearchField, keyword: string) => void
}

/**
 * Searches one invoice column at a time. The draft is committed only on
 * submit so the list request is not repeated for every keystroke.
 */
export function InvoiceSearchBar(props: InvoiceSearchBarProps) {
  const { t } = useTranslation()
  const errorId = useId()
  const [field, setField] = useState(props.field)
  const [keyword, setKeyword] = useState(props.keyword)
  const [submitted, setSubmitted] = useState(false)
  const error = submitted ? getInvoiceSearchError(field, keyword) : null

  let inputType = 'search'
  let inputMode: React.HTMLAttributes<HTMLInputElement>['inputMode']
  let placeholder = t('Enter a keyword')
  if (field === 'created_at') {
    inputType = 'date'
  } else if (field === 'user_id') {
    inputMode = 'numeric'
    placeholder = t('Enter a user ID')
  } else if (isInvoiceAmountSearchField(field)) {
    inputMode = 'decimal'
    placeholder = t('Enter an exact amount')
  }

  return (
    <form
      role='search'
      aria-label={t('Search invoice applications')}
      className='flex min-w-0 flex-wrap items-start gap-2'
      onSubmit={(event) => {
        event.preventDefault()
        setSubmitted(true)
        if (getInvoiceSearchError(field, keyword)) return
        props.onSearch(field, keyword.trim())
      }}
    >
      <NativeSelect
        value={field}
        aria-label={t('Search column')}
        onChange={(event) => {
          setField(event.target.value as InvoiceSearchField)
          setKeyword('')
          setSubmitted(false)
        }}
      >
        {INVOICE_SEARCH_FIELDS.map((option) => (
          <NativeSelectOption key={option} value={option}>
            {t(INVOICE_SEARCH_FIELD_LABELS[option])}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <div className='flex min-w-0 flex-col gap-1'>
        <Input
          type={inputType}
          inputMode={inputMode}
          value={keyword}
          placeholder={placeholder}
          aria-label={t('Search keyword')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className='w-56'
          onChange={(event) => setKeyword(event.target.value)}
        />
        {error ? (
          <p id={errorId} className='text-destructive text-xs'>
            {t(error)}
          </p>
        ) : null}
      </div>
      <Button type='submit' variant='outline'>
        <Search data-icon='inline-start' aria-hidden='true' />
        {t('Search')}
      </Button>
    </form>
  )
}
