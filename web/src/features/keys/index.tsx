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
import { normalizeEndpoint } from '@/features/dashboard/lib/api-endpoint'

import { ApiKeysDialogs } from './components/api-keys-dialogs'
import { ApiKeysPrimaryButtons } from './components/api-keys-primary-buttons'
import { ApiKeysProvider } from './components/api-keys-provider'
import { ApiKeysTable } from './components/api-keys-table'

export function ApiKeysEndpoint() {
  const { t } = useTranslation()
  const { items } = useApiInfo()
  const endpoint = normalizeEndpoint(items[0]?.url)

  return (
    <div className='bg-card flex min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2.5'>
      <div className='flex min-w-0 items-center gap-2'>
        <Link2
          className='text-muted-foreground size-4 shrink-0'
          aria-hidden='true'
        />
        <span className='text-muted-foreground shrink-0 text-sm font-medium'>
          {t('API URL')}
        </span>
        <code
          className='text-foreground min-w-0 truncate font-mono text-sm'
          title={endpoint}
        >
          {endpoint}
        </code>
      </div>
      <CopyButton
        value={endpoint}
        size='sm'
        className='size-7 p-0'
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
