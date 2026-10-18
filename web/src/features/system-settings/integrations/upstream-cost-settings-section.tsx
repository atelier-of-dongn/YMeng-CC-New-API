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
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormLabel,
} from '@/components/ui/form'
import { Switch } from '@/components/ui/switch'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOption } from '../hooks/use-update-option'
import {
  getChangedUpstreamCostSettings,
  toFlatUpstreamCostSettings,
  toUpstreamCostFormValues,
  upstreamCostSettingsSchema,
  type FlatUpstreamCostSettings,
  type UpstreamCostSettingsFormInput,
  type UpstreamCostSettingsFormValues,
} from '../lib/upstream-cost-settings'
import { UpstreamCostFeishuFields } from './upstream-cost-feishu-fields'
import { UpstreamCostIntervalFields } from './upstream-cost-interval-fields'

type UpstreamCostSettingsSectionProps = {
  defaultValues: FlatUpstreamCostSettings
  /** Upstream costs are matched against consume logs. */
  logConsumeEnabled: boolean
}

export function UpstreamCostSettingsSection(
  props: UpstreamCostSettingsSectionProps
) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const baselineRef = useRef<FlatUpstreamCostSettings>(props.defaultValues)
  const baselineSerializedRef = useRef(JSON.stringify(props.defaultValues))

  const formDefaults = useMemo(
    () => toUpstreamCostFormValues(props.defaultValues),
    [props.defaultValues]
  )

  const form = useForm<
    UpstreamCostSettingsFormInput,
    unknown,
    UpstreamCostSettingsFormValues
  >({
    resolver: zodResolver(upstreamCostSettingsSchema),
    defaultValues: formDefaults,
  })

  useResetForm(form, formDefaults)

  useEffect(() => {
    const serialized = JSON.stringify(props.defaultValues)
    if (serialized === baselineSerializedRef.current) return
    baselineRef.current = props.defaultValues
    baselineSerializedRef.current = serialized
  }, [props.defaultValues])

  const onSubmit = async (values: UpstreamCostSettingsFormValues) => {
    const next = toFlatUpstreamCostSettings(values)
    const changedKeys = getChangedUpstreamCostSettings(
      next,
      baselineRef.current
    )

    if (changedKeys.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    try {
      for (const key of changedKeys) {
        await updateOption.mutateAsync({ key, value: next[key] })
      }
    } catch {
      // useUpdateOption already reported the failure.
      return
    }

    // The secret stays write-only: clear the field once it has been saved.
    const saved = { ...next, 'upstream_cost_setting.feishu_secret': '' }
    baselineRef.current = saved
    baselineSerializedRef.current = JSON.stringify(saved)
    form.setValue('upstream_cost_setting.feishu_secret', '')
  }

  return (
    <SettingsSection title={t('Upstream Cost Monitoring')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />

          {!props.logConsumeEnabled && (
            <Alert>
              <AlertTriangle />
              <AlertTitle>{t('Quota usage recording is disabled')}</AlertTitle>
              <AlertDescription>
                {t(
                  'Upstream costs are matched against consume logs. Turn on "Record quota usage" in Log Maintenance to track upstream costs and profit.'
                )}
              </AlertDescription>
            </Alert>
          )}

          <FormField
            control={form.control}
            name='upstream_cost_setting.enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable upstream cost monitoring')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Track the group ratio, balance, and per-request cost of channels whose upstream is another New API site.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <FormField
            control={form.control}
            name='upstream_cost_setting.auto_detect'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Auto-detect upstream sites')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Automatically check whether each channel points to a New API site and start monitoring it.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <UpstreamCostIntervalFields form={form} />

          <UpstreamCostFeishuFields form={form} />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
