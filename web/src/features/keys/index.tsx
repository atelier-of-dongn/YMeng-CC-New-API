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
import { Link2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { SectionPageLayout } from '@/components/layout'
import { useApiInfo } from '@/features/dashboard/hooks/use-status-data'
import { normalizeApiBaseUrl } from '@/features/dashboard/lib/api-endpoint'

import { ApiKeysDialogs } from './components/api-keys-dialogs'
import { ApiKeysPrimaryButtons } from './components/api-keys-primary-buttons'
import { ApiKeysProvider } from './components/api-keys-provider'
import { ApiKeysTable } from './components/api-keys-table'

export function ApiKeysEndpoint() {
  const { t } = useTranslation()
  const { items } = useApiInfo()
  const endpoint = normalizeApiBaseUrl(items[0]?.url)

  return (
    <div className='bg-card flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3'>
      <div className='flex min-w-0 flex-1 items-start gap-2 sm:items-center'>
        <Link2
          className='text-muted-foreground mt-0.5 size-4 shrink-0 sm:mt-0'
          aria-hidden='true'
        />
        <div className='flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2'>
          <span className='text-muted-foreground shrink-0 text-sm font-medium'>
            {t('API URL')}
          </span>
          <code
            className='text-foreground block min-w-0 font-mono text-xs break-all sm:truncate sm:text-sm'
            title={endpoint}
          >
            {endpoint}
          </code>
        </div>
      </div>
      <CopyButton
        value={endpoint}
        size='sm'
        className='size-7 self-end p-0 sm:self-auto'
        iconClassName='size-3.5'
        tooltip={t('Copy URL')}
        aria-label={t('Copy URL')}
      />
    </div>
  )
}

export function ApiKeys() {
  const { t } = useTranslation()
  return (
    <ApiKeysProvider>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>{t('API Keys')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <ApiKeysPrimaryButtons />
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='flex flex-col gap-3'>
            <ApiKeysEndpoint />
            <ApiKeysTable />
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <ApiKeysDialogs />
    </ApiKeysProvider>
  )
}
