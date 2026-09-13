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
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const schema = z.object({
  enabled: z.boolean(),
  commissionRatePercent: z.coerce.number().int().min(0).max(100),
})

type Values = z.infer<typeof schema>

export function AffiliateSettingsSection({
  defaultValues,
}: {
  defaultValues: {
    enabled: boolean
    commissionRatePercent: number
  }
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const form = useForm<Values>({
    resolver: zodResolver(schema) as unknown as Resolver<Values>,
    defaultValues: {
      enabled: defaultValues.enabled,
      commissionRatePercent: defaultValues.commissionRatePercent,
    },
  })

  const { isDirty, isSubmitting } = form.formState
  const enabled = form.watch('enabled')

  async function onSubmit(values: Values) {
    const updates: Array<{ key: string; value: string }> = []

    if (values.commissionRatePercent !== defaultValues.commissionRatePercent) {
      updates.push({
        key: 'affiliate_setting.commission_rate_percent',
        value: String(values.commissionRatePercent),
      })
    }

    if (values.enabled !== defaultValues.enabled) {
      updates.push({
        key: 'affiliate_setting.enabled',
        value: String(values.enabled),
      })
    }

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const update of updates) {
      await updateOption.mutateAsync(update)
    }

    form.reset(values)
  }

  return (
    <SettingsSection title={t('Affiliate Commission')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending || isSubmitting}
            isSaveDisabled={!isDirty}
            saveLabel='Save affiliate settings'
          />

          <Alert>
            <AlertDescription>
              {t(
                'Commission is settled after each successful billing: the inviter receives the configured percentage of the invitee consumption. Amounts below one quota unit are carried over to the next settlement.'
              )}
            </AlertDescription>
          </Alert>

          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable affiliate commission')}</FormLabel>
                  <FormDescription>
                    {t(
                      'When disabled, no new commission is settled. Existing balances and history stay untouched.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={updateOption.isPending || isSubmitting}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          {enabled && (
            <FormField
              control={form.control}
              name='commissionRatePercent'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Commission rate (%)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      max={100}
                      placeholder='5'
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Percentage of the invitee consumption credited to the inviter. Allowed range is 0 to 100.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}