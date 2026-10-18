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
import { Loader2, Send } from 'lucide-react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { PasswordInput } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { testUpstreamCostFeishu } from '../api'
import type {
  UpstreamCostSettingsFormInput,
  UpstreamCostSettingsFormValues,
} from '../lib/upstream-cost-settings'
import type { UpstreamCostFeishuTestRequest } from '../types'

type UpstreamCostFeishuFieldsProps = {
  form: UseFormReturn<
    UpstreamCostSettingsFormInput,
    unknown,
    UpstreamCostSettingsFormValues
  >
}

/** Feishu/Lark alert webhook, write-only signing secret, and a test action. */
export function UpstreamCostFeishuFields(props: UpstreamCostFeishuFieldsProps) {
  const { t } = useTranslation()

  const testMutation = useMutation({
    mutationFn: async (request: UpstreamCostFeishuTestRequest) =>
      requireServerSuccess(await testUpstreamCostFeishu(request)),
    onSuccess: () => {
      toast.success(t('Test message sent'))
    },
    onError: (error) => {
      handleServerError(error, t('Failed to send test message'))
    },
  })

  // Tests the unsaved values; empty fields make the backend use saved ones.
  const handleSendTest = async () => {
    const valid = await props.form.trigger(
      'upstream_cost_setting.feishu_webhook_url'
    )
    if (!valid) return
    const setting = props.form.getValues('upstream_cost_setting')
    testMutation.mutate({
      webhook_url: setting.feishu_webhook_url.trim(),
      secret: setting.feishu_secret,
    })
  }

  return (
    <>
      <FormField
        control={props.form.control}
        name='upstream_cost_setting.feishu_webhook_url'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Feishu webhook URL')}</FormLabel>
            <FormControl>
              <Input
                placeholder='https://open.feishu.cn/open-apis/bot/v2/hook/...'
                autoComplete='off'
                {...field}
              />
            </FormControl>
            <FormDescription>
              {t(
                'Upstream cost alerts are sent to this Feishu or Lark bot. Leave empty to disable alerts.'
              )}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={props.form.control}
        name='upstream_cost_setting.feishu_secret'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Feishu signing secret')}</FormLabel>
            <FormControl>
              <PasswordInput
                placeholder={t('Leave empty to keep unchanged')}
                autoComplete='new-password'
                {...field}
              />
            </FormControl>
            <FormDescription>
              {t(
                'Only needed when signature verification is enabled for the bot.'
              )}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className='flex flex-wrap items-center gap-3'>
        <Button
          type='button'
          variant='outline'
          onClick={() => void handleSendTest()}
          disabled={testMutation.isPending}
        >
          {testMutation.isPending ? (
            <Loader2 className='animate-spin' data-icon='inline-start' />
          ) : (
            <Send data-icon='inline-start' />
          )}
          {t('Send test message')}
        </Button>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Uses the values entered above; empty fields fall back to the saved settings.'
          )}
        </p>
      </div>
    </>
  )
}
