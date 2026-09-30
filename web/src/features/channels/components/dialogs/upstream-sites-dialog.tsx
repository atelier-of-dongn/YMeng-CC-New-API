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
import { Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  StaticDataTable,
  staticDataTableClassNames,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { TruncatedText } from '@/components/truncated-text'
import { Button } from '@/components/ui/button'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { refreshUpstreamCost } from '../../api'
import { useUpstreamSites } from '../../hooks/use-upstream-sites'
import type { UpstreamSiteView } from '../../types'
import {
  UpstreamEmptyValue,
  UpstreamPricingStatusBadge,
  UpstreamSiteStatusBadge,
} from '../upstream-cost-badges'
import { UpstreamSiteCostFactorInput } from './upstream-site-cost-factor-input'

/** The backend picks up refresh requests within ~15 s, so poll at that pace. */
const SITES_REFETCH_INTERVAL_MS = 15 * 1000

type UpstreamSitesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UpstreamSitesDialog(props: UpstreamSitesDialogProps) {
  const { t } = useTranslation()
  const sitesQuery = useUpstreamSites({
    enabled: props.open,
    refetchInterval: SITES_REFETCH_INTERVAL_MS,
  })

  const refreshMutation = useMutation({
    mutationFn: async (siteId?: number) =>
      requireServerSuccess(await refreshUpstreamCost(siteId)),
    onSuccess: () => {
      toast.success(t('Refresh requested'), {
        description: t('Refresh requests take effect within about 15 seconds.'),
      })
    },
    onError: (error) => {
      handleServerError(error, t('Failed to refresh upstream sites'))
    },
  })
  const isRefreshing = (siteId?: number) =>
    refreshMutation.isPending && refreshMutation.variables === siteId

  const columns: StaticDataTableColumn<UpstreamSiteView>[] = [
    {
      id: 'site',
      header: t('Site'),
      cell: (site) => (
        <div className='flex max-w-[220px] min-w-0 flex-col'>
          <TruncatedText
            text={site.name || site.base_url}
            maxWidth='max-w-full'
            className='font-medium'
          />
          <TruncatedText
            text={site.base_url}
            maxWidth='max-w-full'
            className='text-muted-foreground font-mono text-xs'
          />
        </div>
      ),
    },
    {
      id: 'status',
      header: t('Status'),
      cell: (site) => (
        <UpstreamSiteStatusBadge status={site.status} className='-ml-1.5' />
      ),
    },
    {
      id: 'version',
      header: t('Version'),
      cellClassName: staticDataTableClassNames.mutedCodeCell,
      cell: (site) => site.version || '-',
    },
    {
      id: 'pricing',
      header: t('Pricing'),
      cell: (site) => (
        <UpstreamPricingStatusBadge
          status={site.pricing_status}
          className='-ml-1.5'
        />
      ),
    },
    {
      id: 'channels',
      header: t('Channels'),
      cellClassName: 'font-mono',
      cell: (site) => site.channel_count,
    },
    {
      id: 'cost_factor',
      header: t('Cost Factor'),
      cell: (site) => (
        <UpstreamSiteCostFactorInput
          key={`${site.id}:${site.cost_factor}`}
          site={site}
        />
      ),
    },
    {
      id: 'last_error',
      header: t('Last Error'),
      cell: (site) =>
        site.last_error ? (
          <TruncatedText
            text={site.last_error}
            maxWidth='max-w-[180px]'
            className='text-destructive text-xs'
          />
        ) : (
          <UpstreamEmptyValue />
        ),
    },
    {
      id: 'actions',
      header: t('Actions'),
      className: staticDataTableClassNames.actionHeaderCell,
      cellClassName: staticDataTableClassNames.actionCell,
      cell: (site) => (
        <Button
          variant='ghost'
          size='sm'
          onClick={() => refreshMutation.mutate(site.id)}
          disabled={refreshMutation.isPending}
        >
          {isRefreshing(site.id) ? (
            <Loader2 className='animate-spin' data-icon='inline-start' />
          ) : (
            <RefreshCw data-icon='inline-start' />
          )}
          {t('Refresh')}
        </Button>
      ),
    },
  ]

  let content = (
    <StaticDataTable
      data={sitesQuery.data ?? []}
      columns={columns}
      getRowKey={(site) => site.id}
      emptyContent={t('No upstream sites detected yet')}
    />
  )
  if (sitesQuery.isPending) {
    content = <LoadingState size='sm' className='min-h-[200px]' />
  } else if (sitesQuery.isError) {
    content = (
      <ErrorState
        description={sitesQuery.error.message}
        onRetry={() => void sitesQuery.refetch()}
        className='min-h-[200px]'
      />
    )
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Upstream Sites')}
      description={t(
        'New API sites detected behind your channels. The cost factor multiplies upstream charges when computing your cost (1 = unchanged).'
      )}
      contentClassName='sm:max-w-5xl'
      footer={
        <>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Close')}
          </Button>
          <Button
            onClick={() => refreshMutation.mutate(undefined)}
            disabled={refreshMutation.isPending}
          >
            {isRefreshing(undefined) ? (
              <Loader2 className='animate-spin' data-icon='inline-start' />
            ) : (
              <RefreshCw data-icon='inline-start' />
            )}
            {t('Refresh All')}
          </Button>
        </>
      }
    >
      <div className='space-y-3'>
        <p className='text-muted-foreground text-xs'>
          {t('Refresh requests take effect within about 15 seconds.')}
        </p>
        {content}
      </div>
    </Dialog>
  )
}
