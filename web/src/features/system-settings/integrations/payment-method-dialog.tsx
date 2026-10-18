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
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
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
import { Textarea } from '@/components/ui/textarea'
import { getPaymentIcon } from '@/features/wallet/lib/ui'
import { isHttpsUrl } from '@/lib/content-format'

const createPaymentMethodDialogSchema = (t: (key: string) => string) =>
  z.object({
    name: z.string().min(1, t('Payment method name is required')),
    type: z.string().min(1, t('Payment type key is required')),
    icon: z.string().optional(),
    min_topup: z.string().optional(),
    show_topup_notice: z.boolean(),
    show_topup_link: z.boolean(),
    topup_notice_text: z.string().optional(),
    topup_link_image: z
      .string()
      .refine(
        (value) => !value.trim() || isHttpsUrl(value.trim()),
        t('Enter a valid HTTPS image URL')
      ),
  })

type PaymentMethodDialogFormValues = z.infer<
  ReturnType<typeof createPaymentMethodDialogSchema>
>

const PAYMENT_METHOD_FORM_ID = 'payment-method-form'

export type PaymentMethodData = {
  name: string
  type: string
  icon?: string
  min_topup?: string
  color?: string
  show_topup_notice?: string
  show_topup_link?: string
  topup_notice_text?: string
  topup_link_image?: string
}

type PaymentMethodDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfigureStore?: () => void
  onSave: (data: PaymentMethodData) => void
  editData?: PaymentMethodData | null
}

const PAYMENT_TYPE_ICON_NAMES: Record<string, string> = {
  catfk: 'SiAlipay',
  alipay: 'SiAlipay',
  stripe: 'SiStripe',
  waffo_pancake: 'LuCreditCard',
  wxpay: 'SiWechat',
}

const getDefaultIconName = (type: string) => PAYMENT_TYPE_ICON_NAMES[type] ?? ''

export function PaymentMethodDialog({
  open,
  onOpenChange,
  onSave,
  onConfigureStore,
  editData,
}: PaymentMethodDialogProps) {
  const { t } = useTranslation()
  const isEditMode = !!editData
  const paymentMethodDialogSchema = createPaymentMethodDialogSchema(t)
  const paymentTypeOptions = [
    {
      iconName: 'SiAlipay',
      label: `${t('Alipay')} (Epay: alipay)`,
      name: t('Alipay'),
      value: 'alipay',
    },
    {
      iconName: 'SiAlipay',
      label: t('Yunmao'),
      name: t('Alipay'),
      value: 'catfk',
    },
    {
      iconName: 'SiWechat',
      label: `${t('WeChat Pay')} (Epay: wxpay)`,
      name: t('WeChat Pay'),
      value: 'wxpay',
    },
    {
      iconName: 'SiStripe',
      label: `${t('Stripe')} (stripe)`,
      name: t('Stripe'),
      value: 'stripe',
    },
    {
      iconName: 'LuCreditCard',
      label: 'Waffo Pancake (waffo_pancake)',
      name: 'Waffo Pancake',
      value: 'waffo_pancake',
    },
  ]
  const getPaymentTypeOption = (value: string) =>
    paymentTypeOptions.find((option) => option.value === value)

  const form = useForm<PaymentMethodDialogFormValues>({
    resolver: zodResolver(paymentMethodDialogSchema),
    defaultValues: {
      name: '',
      type: '',
      icon: '',
      min_topup: '',
      show_topup_notice: true,
      show_topup_link: true,
      topup_notice_text: '',
      topup_link_image: '',
    },
  })

  const iconValue = form.watch('icon')
  const showTopupNotice = form.watch('show_topup_notice')
  const showTopupLink = form.watch('show_topup_link')
  const topupLinkImage = form.watch('topup_link_image')
  const topupLinkImagePreview = isHttpsUrl(topupLinkImage.trim())
    ? topupLinkImage.trim()
    : ''

  useEffect(() => {
    if (editData) {
      form.reset({
        name: editData.name,
        type: editData.type,
        icon: editData.icon ?? getDefaultIconName(editData.type),
        min_topup: editData.min_topup ?? '',
        show_topup_notice: editData.show_topup_notice !== 'false',
        show_topup_link: editData.show_topup_link !== 'false',
        topup_notice_text: editData.topup_notice_text ?? '',
        topup_link_image: editData.topup_link_image ?? '',
      })
    } else {
      form.reset({
        name: '',
        type: '',
        icon: '',
        min_topup: '',
        show_topup_notice: true,
        show_topup_link: true,
        topup_notice_text: '',
        topup_link_image: '',
      })
    }
  }, [editData, form, open])

  const handleSubmit = (values: PaymentMethodDialogFormValues) => {
    const data: PaymentMethodData = {
      name: values.name,
      type: values.type,
      show_topup_notice: String(values.show_topup_notice),
      show_topup_link: String(values.show_topup_link),
    }
    if (editData?.color) {
      data.color = editData.color
    }
    if (values.icon && values.icon.trim() !== '') {
      data.icon = values.icon.trim()
    }
    if (values.min_topup && values.min_topup.trim() !== '') {
      data.min_topup = values.min_topup
    }
    if (values.topup_notice_text?.trim()) {
      data.topup_notice_text = values.topup_notice_text.trim()
    }
    if (values.topup_link_image.trim()) {
      data.topup_link_image = values.topup_link_image.trim()
    }
    onSave(data)
    form.reset()
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditMode ? t('Edit payment method') : t('Add payment method')}
      description={t('Configure a payment method for user recharge options.')}
      contentClassName='sm:max-w-[500px]'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button type='submit' form={PAYMENT_METHOD_FORM_ID}>
            {isEditMode ? t('Update') : t('Add')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id={PAYMENT_METHOD_FORM_ID}
          onSubmit={form.handleSubmit(handleSubmit)}
          className='space-y-4'
        >
          <FormField
            control={form.control}
            name='name'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Name')}</FormLabel>
                <FormControl>
                  <Input placeholder={t('e.g., Alipay, WeChat')} {...field} />
                </FormControl>
                <FormDescription>
                  {t('Display name for this payment method.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='type'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Payment type key')}</FormLabel>
                <FormControl>
                  <Combobox
                    options={paymentTypeOptions}
                    value={field.value}
                    onValueChange={(value) => {
                      if (value === null) return
                      const currentIcon = form.getValues('icon')?.trim()
                      const currentName = form.getValues('name')?.trim()
                      const previousOption = getPaymentTypeOption(field.value)
                      const nextOption = getPaymentTypeOption(value)

                      field.onChange(value)
                      if (
                        nextOption?.iconName &&
                        (!currentIcon ||
                          currentIcon === previousOption?.iconName)
                      ) {
                        form.setValue('icon', nextOption.iconName, {
                          shouldDirty: true,
                        })
                      }
                      if (
                        nextOption?.name &&
                        (!currentName || currentName === previousOption?.name)
                      ) {
                        form.setValue('name', nextOption.name, {
                          shouldDirty: true,
                        })
                      }
                    }}
                    placeholder={t('Select or enter payment type key')}
                    searchPlaceholder={t('Search payment type keys...')}
                    allowCustomValue
                  />
                </FormControl>
                <FormDescription className='leading-relaxed'>
                  {t(
                    'Choose the payment provider. Store payments use the configured product tiers.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {form.watch('type') === 'catfk' && onConfigureStore && (
            <Button type='button' variant='outline' onClick={onConfigureStore}>
              {t('Store payment settings')}
            </Button>
          )}
          <FormField
            control={form.control}
            name='icon'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Icon')}</FormLabel>
                <FormControl>
                  <div className='flex items-center gap-2'>
                    <Input
                      placeholder={t('e.g., SiAlipay')}
                      {...field}
                      className='flex-1'
                    />
                    {iconValue?.trim() &&
                      getPaymentIcon(
                        form.watch('type'),
                        'text-muted-foreground size-5 shrink-0',
                        iconValue,
                        form.watch('name')
                      )}
                  </div>
                </FormControl>
                <FormDescription>
                  {t(
                    'Enter a react-icons component name or an https image URL. Invalid values show no icon.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='min_topup'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Minimum top-up (optional)')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    step='0.01'
                    placeholder={t('e.g., 50')}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t('Optional minimum recharge amount for this method.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className='space-y-3'>
            <FormField
              control={form.control}
              name='show_topup_notice'
              render={({ field }) => (
                <FormItem className='flex items-center justify-between gap-4 rounded-lg border p-3'>
                  <div className='space-y-1'>
                    <FormLabel>{t('Show compatibility notice')}</FormLabel>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='topup_notice_text'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Custom notice text')}</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={t(
                        'e.g., USDT payments may take a few minutes to confirm.'
                      )}
                      disabled={!showTopupNotice}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='show_topup_link'
              render={({ field }) => (
                <FormItem className='flex items-center justify-between gap-4 rounded-lg border p-3'>
                  <div className='space-y-1'>
                    <FormLabel>{t('Show top-up link')}</FormLabel>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='topup_link_image'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Top-up link image URL')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder='https://example.com/images/topup.png'
                      disabled={!showTopupLink}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                  {showTopupLink && topupLinkImagePreview && (
                    <div className='bg-muted/30 flex justify-center rounded-lg border p-3'>
                      <img
                        src={topupLinkImagePreview}
                        alt={t('Top-up link image preview')}
                        className='h-12 max-w-full rounded-lg object-contain'
                      />
                    </div>
                  )}
                </FormItem>
              )}
            />
          </div>
        </form>
      </Form>
    </Dialog>
  )
}
