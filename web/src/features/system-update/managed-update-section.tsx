import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

type UpdateStatus = {
  supported: boolean
  reason: string
  state: string
  current_version: string
  target_version: string
  operation_id: string
  draining: boolean
}

type ManagedRelease = {
  tag: string
  name: string
  compatible: boolean
  reason: string
  image: string
}

export function ManagedUpdateSection(props: { enabled: boolean }) {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const client = useQueryClient()
  const [selected, setSelected] = useState<ManagedRelease | null>(null)
  const status = useQuery({
    queryKey: ['managed-system-update', 'status'],
    enabled: props.enabled && user?.role === 100,
    queryFn: async (): Promise<UpdateStatus> => {
      const response = await api.get('/api/system-update/status')
      return requireServerSuccess(response.data).data
    },
    refetchInterval: (query) => {
      if (!props.enabled) return false
      return query.state.data?.operation_id ? 3000 : false
    },
  })
  const releases = useQuery({
    queryKey: ['managed-system-update', 'releases'],
    enabled: props.enabled && user?.role === 100 && !!status.data && status.data.state !== 'unconfigured',
    queryFn: async (): Promise<ManagedRelease[]> => {
      const response = await api.get('/api/system-update/releases')
      return requireServerSuccess(response.data).data.releases
    },
  })
  const update = useMutation({
    mutationFn: async (release: ManagedRelease) => {
      const response = await api.post('/api/system-update/update', { tag: release.tag }, {
        headers: { 'X-Requested-With': 'YMeng-Update' },
      })
      return requireServerSuccess(response.data)
    },
    onSuccess: () => {
      setSelected(null)
      void client.invalidateQueries({ queryKey: ['managed-system-update'] })
    },
  })
  if (user?.role !== 100) return null
  return (
    <section className='space-y-3 border-t pt-4' aria-label={t('Site updates')}>
      <h3 className='font-medium'>{t('Site updates')}</h3>
      <p className='text-muted-foreground text-sm'>{t('Updates from YMeng-CC-New-API')}</p>
      {status.isPending && <p role='status'>{t('Checking updates...')}</p>}
      {(status.isError || releases.isError) && <Alert variant='destructive'><AlertDescription>{t('Unable to contact the update service.')}</AlertDescription></Alert>}
      {status.data && <Alert><AlertDescription>{status.data.reason || t('Update state: {{state}}', { state: status.data.state })}</AlertDescription></Alert>}
      {releases.data?.map((release) => (
        <div key={release.tag} className='space-y-2'>
          <p className='text-sm font-medium'>{release.name || release.tag}</p>
          {release.reason && <p className='text-muted-foreground text-sm'>{release.reason}</p>}
          <Button type='button' disabled={!status.data?.supported || !release.compatible || update.isPending || !!status.data.operation_id} onClick={() => setSelected(release)}>{t('Install update')}</Button>
        </div>
      ))}
      <ConfirmDialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null) }} title={t('Install update')} desc={t('Prepare the new version while existing requests finish on the current version.')} isLoading={update.isPending} disabled={!status.data?.supported || !selected?.compatible} handleConfirm={() => { if (selected) update.mutate(selected) }} />
    </section>
  )
}
