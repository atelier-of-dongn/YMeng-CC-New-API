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
import type { TFunction } from 'i18next'
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useEffect, useMemo, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { Button } from '@/components/ui/button'
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
  getCustomHeaderNavId,
  getCustomHeaderNavRef,
  HEADER_NAV_BUILTIN_KEYS,
  HEADER_NAV_MAX_CUSTOM_LINKS,
  HEADER_NAV_MAX_ENABLED,
  isSafeHeaderNavHref,
  type HeaderNavBuiltinKey,
} from '@/lib/nav-modules'
import { cn } from '@/lib/utils'

import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import {
  HEADER_NAV_DEFAULT,
  type HeaderNavModulesConfig,
  serializeHeaderNavModules,
} from './config'

const createHeaderNavSchema = (t: TFunction) =>
  z
    .object({
      home: z.boolean(),
      console: z.boolean(),
      pricing: z.object({ enabled: z.boolean(), requireAuth: z.boolean() }),
      rankings: z.object({ enabled: z.boolean(), requireAuth: z.boolean() }),
      docs: z.boolean(),
      about: z.boolean(),
      customLinks: z
        .array(
          z.object({
            id: z.string().trim().min(1),
            enabled: z.boolean(),
            name: z
              .string()
              .trim()
              .max(30, t('Navigation name must be 30 characters or fewer')),
            url: z
              .string()
              .trim()
              .max(2048, t('Jump link must be 2048 characters or fewer')),
          })
        )
        .max(HEADER_NAV_MAX_CUSTOM_LINKS),
      order: z.array(z.string()),
    })
    .superRefine((values, context) => {
      values.customLinks.forEach((link, index) => {
        if (!link.enabled) return
        if (!link.name.trim()) {
          context.addIssue({
            code: 'custom',
            path: ['customLinks', index, 'name'],
            message: t('Navigation name is required'),
          })
        }
        if (!isSafeHeaderNavHref(link.url)) {
          context.addIssue({
            code: 'custom',
            path: ['customLinks', index, 'url'],
            message: t('Enter an internal path or a valid HTTP(S) URL'),
          })
        }
      })

      const ids = values.customLinks.map((link) => link.id)
      if (new Set(ids).size !== ids.length) {
        context.addIssue({
          code: 'custom',
          path: ['customLinks'],
          message: t('Custom navigation identifiers must be unique'),
        })
      }

      if (countEnabledNavigation(values) > HEADER_NAV_MAX_ENABLED) {
        context.addIssue({
          code: 'custom',
          path: ['order'],
          message: t('Up to {{count}} navigation items can be enabled', {
            count: HEADER_NAV_MAX_ENABLED,
          }),
        })
      }
    })

type HeaderNavigationSectionProps = {
  config: HeaderNavModulesConfig
  initialSerialized: string
}

type BuiltinDefinition = {
  key: HeaderNavBuiltinKey
  title: string
  description: string
  requireAuthTitle?: string
  requireAuthDescription?: string
}

function cloneConfig(config: HeaderNavModulesConfig): HeaderNavModulesConfig {
  return {
    ...config,
    pricing: { ...config.pricing },
    rankings: { ...config.rankings },
    customLinks: config.customLinks.map((link) => ({ ...link })),
    order: [...config.order],
  }
}

function isBuiltinEnabled(
  config: HeaderNavModulesConfig,
  key: HeaderNavBuiltinKey
): boolean {
  if (key === 'pricing' || key === 'rankings') return config[key].enabled
  return config[key]
}

function countEnabledNavigation(config: HeaderNavModulesConfig): number {
  const builtinCount = HEADER_NAV_BUILTIN_KEYS.filter((key) =>
    isBuiltinEnabled(config, key)
  ).length
  return builtinCount + config.customLinks.filter((link) => link.enabled).length
}

function moveNavigationReference(
  order: string[],
  source: string,
  target: string
): string[] {
  const sourceIndex = order.indexOf(source)
  const targetIndex = order.indexOf(target)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return order
  }

  const next = [...order]
  next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, source)
  return next
}

export function HeaderNavigationSection(props: HeaderNavigationSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const schema = useMemo(() => createHeaderNavSchema(t), [t])
  const formDefaults = useMemo(() => cloneConfig(props.config), [props.config])
  const [draggedReference, setDraggedReference] = useState<string | null>(null)

  const form = useForm<HeaderNavModulesConfig>({
    resolver: zodResolver(schema),
    defaultValues: formDefaults,
  })
  const customLinks = useFieldArray({
    control: form.control,
    name: 'customLinks',
    keyName: 'formKey',
  })
  const values = form.watch()
  const enabledCount = countEnabledNavigation(values)
  const atEnabledLimit = enabledCount >= HEADER_NAV_MAX_ENABLED

  useEffect(() => {
    form.reset(formDefaults)
  }, [form, formDefaults])

  const builtinDefinitions: BuiltinDefinition[] = [
    {
      key: 'home',
      title: t('Home'),
      description: t('Landing page with system overview.'),
    },
    {
      key: 'console',
      title: t('Console'),
      description: t('User dashboard and quota controls.'),
    },
    {
      key: 'pricing',
      title: t('Model Square'),
      description: t('Public model catalog and pricing page.'),
      requireAuthTitle: t('Require login to view models'),
      requireAuthDescription: t(
        'Visitors must authenticate before accessing the pricing directory.'
      ),
    },
    {
      key: 'rankings',
      title: t('Rankings'),
      description: t('Public rankings page based on live usage data.'),
      requireAuthTitle: t('Require login to view rankings'),
      requireAuthDescription: t(
        'Visitors must authenticate before accessing the rankings page.'
      ),
    },
    {
      key: 'docs',
      title: t('Docs'),
      description: t('Documentation or external knowledge base.'),
    },
    {
      key: 'about',
      title: t('About'),
      description: t('Static page describing the platform.'),
    },
  ]
  const builtinByKey = new Map(
    builtinDefinitions.map(
      (definition) => [definition.key, definition] as const
    )
  )

  const setBuiltinEnabled = (key: HeaderNavBuiltinKey, enabled: boolean) => {
    if (enabled && atEnabledLimit) return
    if (key === 'pricing' || key === 'rankings') {
      form.setValue(`${key}.enabled`, enabled, { shouldDirty: true })
      return
    }
    form.setValue(key, enabled, { shouldDirty: true })
  }

  const moveReference = (reference: string, offset: number) => {
    const index = values.order.indexOf(reference)
    const target = values.order[index + offset]
    if (!target) return
    form.setValue(
      'order',
      moveNavigationReference(values.order, reference, target),
      { shouldDirty: true }
    )
  }

  const addCustomLink = () => {
    if (customLinks.fields.length >= HEADER_NAV_MAX_CUSTOM_LINKS) return
    const id = nanoid(8)
    customLinks.append({ id, enabled: false, name: '', url: '' })
    form.setValue('order', [...values.order, getCustomHeaderNavRef(id)], {
      shouldDirty: true,
    })
  }

  const removeCustomLink = (index: number, id: string) => {
    customLinks.remove(index)
    form.setValue(
      'order',
      values.order.filter(
        (reference) => reference !== getCustomHeaderNavRef(id)
      ),
      { shouldDirty: true }
    )
  }

  const onSubmit = async (submitted: HeaderNavModulesConfig) => {
    const payload = cloneConfig(submitted)
    payload.customLinks = payload.customLinks.map((link) => ({
      ...link,
      name: link.name.trim(),
      url: link.url.trim(),
    }))

    const serialized = serializeHeaderNavModules(payload)
    if (serialized === props.initialSerialized) return

    await updateOption.mutateAsync({
      key: 'HeaderNavModules',
      value: serialized,
    })
  }

  const resetToDefault = () => {
    form.reset(cloneConfig(HEADER_NAV_DEFAULT))
  }

  return (
    <SettingsSection title={t('Header navigation')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            onReset={resetToDefault}
            isSaving={updateOption.isPending}
            resetLabel='Reset to default'
            saveLabel='Save navigation'
          />

          <div className='flex items-center justify-between gap-4'>
            <div>
              <p className='text-sm font-medium'>{t('Navigation order')}</p>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Drag items or use the arrow buttons to change their order.'
                )}
              </p>
            </div>
            <p className='text-muted-foreground text-sm tabular-nums'>
              {t('{{enabled}} / {{limit}} enabled', {
                enabled: enabledCount,
                limit: HEADER_NAV_MAX_ENABLED,
              })}
            </p>
          </div>

          {form.formState.errors.order?.message ? (
            <p className='text-destructive text-sm'>
              {form.formState.errors.order.message}
            </p>
          ) : null}

          <div className='space-y-3'>
            {values.order.map((reference, orderIndex) => {
              const builtinKey = HEADER_NAV_BUILTIN_KEYS.find(
                (key) => key === reference
              )
              const customId = getCustomHeaderNavId(reference)
              const customIndex = customId
                ? customLinks.fields.findIndex((link) => link.id === customId)
                : -1
              const customLink =
                customIndex >= 0 ? values.customLinks[customIndex] : undefined

              if (!builtinKey && !customLink) return null

              const enabled = builtinKey
                ? isBuiltinEnabled(values, builtinKey)
                : Boolean(customLink?.enabled)
              const definition = builtinKey
                ? builtinByKey.get(builtinKey)
                : undefined

              return (
                <div
                  key={reference}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (!draggedReference) return
                    form.setValue(
                      'order',
                      moveNavigationReference(
                        values.order,
                        draggedReference,
                        reference
                      ),
                      { shouldDirty: true }
                    )
                    setDraggedReference(null)
                  }}
                  className={cn(
                    'bg-muted/20 rounded-xl border px-3 py-3',
                    draggedReference === reference && 'opacity-50'
                  )}
                >
                  <div className='flex items-start gap-3'>
                    <button
                      type='button'
                      draggable
                      onDragStart={() => setDraggedReference(reference)}
                      onDragEnd={() => setDraggedReference(null)}
                      className='text-muted-foreground mt-1 cursor-grab'
                      aria-label={t('Drag to reorder')}
                    >
                      <GripVertical className='size-4' aria-hidden='true' />
                    </button>

                    <div className='min-w-0 flex-1 space-y-3'>
                      <div className='flex items-start justify-between gap-4'>
                        <div className='min-w-0'>
                          <p className='text-sm font-medium'>
                            {definition?.title ||
                              customLink?.name ||
                              t('Custom navigation link')}
                          </p>
                          <p className='text-muted-foreground text-xs'>
                            {definition?.description ||
                              t('Custom link to a site page or external URL.')}
                          </p>
                        </div>
                        <Switch
                          checked={enabled}
                          disabled={!enabled && atEnabledLimit}
                          onCheckedChange={(checked) => {
                            if (builtinKey) {
                              setBuiltinEnabled(builtinKey, checked)
                              return
                            }
                            form.setValue(
                              `customLinks.${customIndex}.enabled`,
                              checked,
                              { shouldDirty: true }
                            )
                          }}
                        />
                      </div>

                      {builtinKey === 'pricing' || builtinKey === 'rankings' ? (
                        <div className='border-border/70 flex items-center justify-between gap-4 border-l pl-3'>
                          <div>
                            <p className='text-sm font-medium'>
                              {definition?.requireAuthTitle}
                            </p>
                            <p className='text-muted-foreground text-xs'>
                              {definition?.requireAuthDescription}
                            </p>
                          </div>
                          <Switch
                            checked={values[builtinKey].requireAuth}
                            disabled={!values[builtinKey].enabled}
                            onCheckedChange={(checked) =>
                              form.setValue(
                                `${builtinKey}.requireAuth`,
                                checked,
                                { shouldDirty: true }
                              )
                            }
                          />
                        </div>
                      ) : null}

                      {customLink ? (
                        <div className='grid gap-4 md:grid-cols-2'>
                          <FormField
                            control={form.control}
                            name={`customLinks.${customIndex}.name`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('Navigation name')}</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder={t('For example: Community')}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`customLinks.${customIndex}.url`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('Jump link')}</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder='/page or https://example.com'
                                  />
                                </FormControl>
                                <FormDescription>
                                  {t(
                                    'Use a site path beginning with / or a complete HTTP(S) URL.'
                                  )}
                                </FormDescription>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      ) : null}
                    </div>

                    <div className='flex shrink-0 items-center gap-1'>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        className='size-8'
                        disabled={orderIndex === 0}
                        onClick={() => moveReference(reference, -1)}
                        aria-label={t('Move up')}
                      >
                        <ArrowUp className='size-4' aria-hidden='true' />
                      </Button>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        className='size-8'
                        disabled={orderIndex === values.order.length - 1}
                        onClick={() => moveReference(reference, 1)}
                        aria-label={t('Move down')}
                      >
                        <ArrowDown className='size-4' aria-hidden='true' />
                      </Button>
                      {customLink ? (
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='text-destructive size-8'
                          onClick={() =>
                            removeCustomLink(customIndex, customLink.id)
                          }
                          aria-label={t('Delete custom navigation link')}
                        >
                          <Trash2 className='size-4' aria-hidden='true' />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <Button
            type='button'
            variant='outline'
            className='w-fit'
            disabled={customLinks.fields.length >= HEADER_NAV_MAX_CUSTOM_LINKS}
            onClick={addCustomLink}
          >
            <Plus className='size-4' aria-hidden='true' />
            {t('Add custom navigation link')}
          </Button>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
