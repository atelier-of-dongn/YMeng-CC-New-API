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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getUpstreamMonitors, updateUpstreamMonitor } from '../../api'
import { useUpstreamSites } from '../../hooks/use-upstream-sites'
import { upstreamCostQueryKeys } from '../../lib'
import { getSelectableUpstreamGroups } from '../../lib/upstream-cost'
import type { UpdateUpstreamMonitorParams } from '../../types'
import { useChannels } from '../channels-provider'
import { UpstreamMonitorDetails } from './upstream-monitor-details'
import { UpstreamMonitorSettings } from './upstream-monitor-settings'

type UpstreamMonitorDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UpstreamMonitorDialog(props: UpstreamMonitorDialogProps) {
  const { t } = useTranslation()
  const { currentRow } = useChannels()
  const queryClient = useQueryClient()
  // Unsaved edits; null means the form shows the saved monitor settings.
  const [draft, setDraft] = useState<UpdateUpstreamMonitorParams | null>(null)
  const channelId = currentRow?.id ?? 0
  const enabled = props.open && channelId > 0

  const monitorQuery = useQuery({
    queryKey: upstreamCostQueryKeys.monitorList([channelId]),
    queryFn: async () =>
      requireServerSuccess(await getUpstreamMonitors([channelId])).data ?? [],
    enabled,
    meta: { errorToast: false },
  })
  const monitor = monitorQuery.data?.find(
    (item) => item.channel_id === channelId
  )
  const siteId = monitor?.site_id ?? 0
  const sitesQuery = useUpstreamSites({ enabled: enabled && siteId > 0 })
  const site = sitesQuery.data?.find((item) => item.id === siteId)

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setDraft(null)
    }
    props.onOpenChange(open)
  }

  const saveMutation = useMutation({
    mutationFn: async (params: UpdateUpstreamMonitorParams) =>
      requireServerSuccess(await updateUpstreamMonitor(channelId, params)),
    onSuccess: () => {
      toast.success(t('Upstream monitor updated'))
      void queryClient.invalidateQueries({
        queryKey: upstreamCostQueryKeys.monitors,
      })
      handleOpenChange(false)
    },
    onError: (error) => {
      handleServerError(error, t('Failed to update upstream monitor'))
    },
  })

  if (!currentRow) {
    return null
  }

  const savedValues: UpdateUpstreamMonitorParams = {
    mode: monitor?.mode ?? 'auto',
    manual_group: monitor?.manual_group ?? '',
    manual_ratio: monitor?.manual_ratio ?? null,
  }
  const values = draft ?? savedValues
  const isDirty =
    values.mode !== savedValues.mode ||
    values.manual_group !== savedValues.manual_group ||
    values.manual_ratio !== savedValues.manual_ratio
  // Saving an untouched form still creates the monitor row for a new channel.
  const canSave =
    monitorQuery.isSuccess &&
    !saveMutation.isPending &&
    (values.mode !== 'manual' ||
      (values.manual_ratio !== null &&
        Number.isFinite(values.manual_ratio) &&
        values.manual_ratio > 0 &&
        values.manual_ratio <= 100)) &&
    (isDirty || !monitor)

  let body: ReactNode
  if (monitorQuery.isPending) {
    body = <LoadingState size='sm' className='min-h-[200px]' />
  } else if (monitorQuery.isError) {
    body = (
      <ErrorState
        description={monitorQuery.error.message}
        onRetry={() => void monitorQuery.refetch()}
        className='min-h-[200px]'
      />
    )
  } else {
    body = (
      <div className='space-y-4'>
        {monitor ? (
          <UpstreamMonitorDetails monitor={monitor} site={site} />
        ) : (
          <Alert>
            <AlertDescription>
              {t(
                'This channel is not monitored yet. Save to start detecting its upstream site.'
              )}
            </AlertDescription>
          </Alert>
        )}
        <UpstreamMonitorSettings
          values={values}
          groups={monitor ? getSelectableUpstreamGroups(monitor) : []}
          disabled={saveMutation.isPending}
          onChange={setDraft}
        />
      </div>
    )
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={handleOpenChange}
      title={t('Upstream Monitor')}
      description={currentRow.name}
      contentClassName='sm:max-w-2xl'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => handleOpenChange(false)}
            disabled={saveMutation.isPending}
          >
            {t('Cancel')}
          </Button>
          <Button
            onClick={() => saveMutation.mutate(values)}
            disabled={!canSave}
          >
            {saveMutation.isPending && (
              <Loader2 className='animate-spin' data-icon='inline-start' />
            )}
            {saveMutation.isPending ? t('Saving...') : t('Save')}
          </Button>
        </>
      }
    >
      {body}
    </Dialog>
  )
}
