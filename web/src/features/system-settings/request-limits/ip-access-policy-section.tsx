/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { MultiSelect } from '@/components/multi-select'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
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
  IpAccessPolicyEnabled: z.boolean(),
  IpAccessPolicyAllowedGroups: z.array(z.string()),
})

type FormValues = z.infer<typeof schema>

type IpAccessPolicySectionProps = {
  defaultValues: {
    IpAccessPolicyEnabled: boolean
    IpAccessPolicyAllowedGroups: string
    GroupRatio: string
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function parseGroupNames(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.keys(parsed).sort((a, b) => a.localeCompare(b))
      : []
  } catch {
    return []
  }
}

export function IpAccessPolicySection({
  defaultValues,
}: IpAccessPolicySectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const groups = useMemo(
    () => parseGroupNames(defaultValues.GroupRatio),
    [defaultValues.GroupRatio]
  )
  const normalizedDefaults = useMemo<FormValues>(
    () => ({
      IpAccessPolicyEnabled: defaultValues.IpAccessPolicyEnabled,
      IpAccessPolicyAllowedGroups: parseStringArray(
        defaultValues.IpAccessPolicyAllowedGroups
      ),
    }),
    [defaultValues]
  )
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: normalizedDefaults,
  })

  useEffect(() => {
    form.reset(normalizedDefaults)
  }, [form, normalizedDefaults])

  const onSubmit = async (values: FormValues) => {
    await updateOption.mutateAsync({
      key: 'IpAccessPolicyAllowedGroups',
      value: JSON.stringify(values.IpAccessPolicyAllowedGroups),
    })
    await updateOption.mutateAsync({
      key: 'IpAccessPolicyEnabled',
      value: values.IpAccessPolicyEnabled,
    })
  }

  return (
    <SettingsSection title={t('Mainland IP Web Visibility')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            saveLabel='Save IP visibility settings'
          />

          <FormField
            control={form.control}
            name='IpAccessPolicyEnabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable Mainland IP UI filtering')}</FormLabel>
                  <FormDescription>
                    {t(
                      'When enabled, Mainland China users only see the selected groups in the web interface. Model API calls are never restricted.'
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
            name='IpAccessPolicyAllowedGroups'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Groups allowed for Mainland IPs')}</FormLabel>
                <FormControl>
                  <MultiSelect
                    options={groups.map((group) => ({
                      label: group,
                      value: group,
                    }))}
                    selected={field.value}
                    onChange={field.onChange}
                    placeholder={t('Select allowed groups')}
                    maxVisibleChips={8}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'The list controls web visibility only. An empty list hides every model group from Mainland China users; API Key calls remain unaffected.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
