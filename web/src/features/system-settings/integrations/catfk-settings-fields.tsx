import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { toIntlLocale } from '@/i18n/languages'
import { api } from '@/lib/api'
import { formatCurrencyFromUSD } from '@/lib/currency'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { CatFKProductDialog } from './catfk-product-dialog'
import {
  catfkChannelsSchema,
  parseCatFKChannels,
  parseCatFKProducts,
  type CatFKProduct,
  type CatFKChannel,
} from './catfk-schema'

export type CatFKFormValues = {
  CatFKEnabled: boolean
  CatFKStoreToken: string
  CatFKProducts: string
  CatFKChannels: string
}
type Props = {
  values: CatFKFormValues
  onChange: (key: keyof CatFKFormValues, value: string | boolean) => void
  complianceConfirmed: boolean
}
export function CatFKSettingsFields(props: Props) {
  const { t, i18n } = useTranslation()
  const [editing, setEditing] = useState<CatFKProduct | null>(null)
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState<CatFKProduct | null>(null)
  const [channelResult, setChannelResult] = useState<{
    token: string
    channels: CatFKChannel[]
  } | null>(null)
  const tokenRef = useRef(props.values.CatFKStoreToken)
  const generation = useRef(0)
  if (tokenRef.current !== props.values.CatFKStoreToken) {
    tokenRef.current = props.values.CatFKStoreToken
    generation.current += 1
  }
  const available =
    channelResult?.token === props.values.CatFKStoreToken
      ? channelResult.channels
      : null
  let products: CatFKProduct[] = [],
    channels: CatFKChannel[] = []
  let invalid = false
  try {
    products = parseCatFKProducts(props.values.CatFKProducts)
    channels = parseCatFKChannels(props.values.CatFKChannels)
  } catch {
    invalid = true
  }
  const readChannels = useMutation({
    mutationFn: async (request: { token: string; generation: number }) => {
      const response = await api.post<{
        success: boolean
        message?: string
        data: unknown
      }>('/api/option/catfk/channels', { store_token: request.token.trim() })
      return catfkChannelsSchema.parse(requireServerSuccess(response.data).data)
    },
    onSuccess: (channels, request) => {
      if (
        request.generation === generation.current &&
        request.token === tokenRef.current
      ) {
        setChannelResult({ token: request.token, channels })
      }
    },
    onError: (error) => handleServerError(error),
  })
  return (
    <div className='space-y-6'>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Store payments use live CNY quotes and credit the configured USD balance.'
        )}
      </p>
      <div className='flex items-center justify-between gap-4'>
        <Label htmlFor='catfk-enabled'>{t('Enable CatFK')}</Label>
        <Switch
          id='catfk-enabled'
          checked={props.values.CatFKEnabled}
          disabled={!props.complianceConfirmed}
          onCheckedChange={(value) => props.onChange('CatFKEnabled', value)}
        />
      </div>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Disabling CatFK stops new orders only. Existing orders can still be processed.'
        )}
      </p>
      <div className='space-y-2'>
        <Label htmlFor='catfk-token'>{t('CatFK store token')}</Label>
        <Input
          id='catfk-token'
          type='password'
          autoComplete='new-password'
          value={props.values.CatFKStoreToken}
          onChange={(event) => {
            props.onChange('CatFKStoreToken', event.target.value)
            setChannelResult(null)
          }}
        />
        <p className='text-muted-foreground text-sm'>
          {t(
            'Leave blank to keep the saved store token. Never enter a user session key.'
          )}
        </p>
      </div>
      <div className='space-y-3'>
        <h4 className='font-medium'>{t('CatFK product mappings')}</h4>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Selling prices come from live CatFK quotes. Each order buys one code.'
          )}
        </p>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Match each product’s expected credited balance (USD) to an amount option in General. Use the balance value, not the CNY selling price or converted display amount. Unmatched presets cannot use this payment method.'
          )}
        </p>
        {invalid && (
          <p role='alert'>{t('Invalid CatFK mapping configuration')}</p>
        )}
        {!products.length && (
          <p className='text-muted-foreground text-sm'>
            {t('No CatFK products configured')}
          </p>
        )}
        {products.map((product) => (
          <div
            key={product.id}
            className='flex flex-wrap items-center justify-between gap-3 rounded-md border p-3'
          >
            <div className='min-w-0 break-all'>
              <p>
                {product.name} ({product.id})
              </p>
              <p className='text-muted-foreground text-sm'>
                {product.goods_key} ·{' '}
                {formatCurrencyFromUSD(product.amount, {
                  locale: toIntlLocale(i18n.resolvedLanguage || i18n.language),
                })}
              </p>
            </div>
            <div className='flex gap-2'>
              <Button
                type='button'
                variant='outline'
                aria-label={t('Edit CatFK product {{name}}', {
                  name: product.name,
                })}
                onClick={() => {
                  setEditing(product)
                  setOpen(true)
                }}
              >
                {t('Edit')}
              </Button>
              <Button
                type='button'
                variant='outline'
                aria-label={t('Delete CatFK product {{name}}', {
                  name: product.name,
                })}
                onClick={() => setDeleting(product)}
              >
                {t('Delete')}
              </Button>
            </div>
          </div>
        ))}
        <Button
          type='button'
          disabled={invalid || products.length >= 100}
          onClick={() => {
            setEditing(null)
            setOpen(true)
          }}
        >
          {t('Add product')}
        </Button>
      </div>
      <div className='space-y-3'>
        <h4 className='font-medium'>{t('CatFK payment channels')}</h4>
        <Button
          type='button'
          variant='outline'
          disabled={readChannels.isPending}
          onClick={() => {
            setChannelResult(null)
            readChannels.mutate({
              token: props.values.CatFKStoreToken,
              generation: generation.current,
            })
          }}
        >
          {readChannels.isPending ? t('Loading...') : t('Read CatFK channels')}
        </Button>
        {available !== null && !available.length && (
          <p>{t('No CatFK channels returned')}</p>
        )}
        {channels.length > 0 && available === null && (
          <p className='text-muted-foreground text-sm'>
            {t(
              'Saved channels are not proof of current availability. Read channels again to verify.'
            )}
          </p>
        )}
        {(available ?? channels).map((channel) => (
          <div key={channel.id} className='flex items-center gap-2'>
            <Checkbox
              id={`catfk-channel-${channel.id}`}
              checked={channels.some((item) => item.id === channel.id)}
              disabled={available === null || invalid}
              onCheckedChange={(checked) =>
                props.onChange(
                  'CatFKChannels',
                  JSON.stringify(
                    checked
                      ? [
                          ...channels.filter((item) => item.id !== channel.id),
                          channel,
                        ]
                      : channels.filter((item) => item.id !== channel.id)
                  )
                )
              }
            />
            <Label htmlFor={`catfk-channel-${channel.id}`}>
              {channel.name}
            </Label>
          </div>
        ))}
      </div>
      <CatFKProductDialog
        open={open}
        onOpenChange={setOpen}
        product={editing}
        products={products}
        onSave={(product) =>
          props.onChange(
            'CatFKProducts',
            JSON.stringify(
              editing
                ? products.map((item) =>
                    item.id === editing.id ? product : item
                  )
                : [...products, product]
            )
          )
        }
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(value) => {
          if (!value) setDeleting(null)
        }}
        title={t('Delete product')}
        desc={t(
          'Remove this CatFK mapping? Existing orders keep their original product snapshot.'
        )}
        destructive
        confirmText={t('Delete')}
        handleConfirm={() => {
          props.onChange(
            'CatFKProducts',
            JSON.stringify(products.filter((item) => item.id !== deleting?.id))
          )
          setDeleting(null)
        }}
      />
    </div>
  )
}
