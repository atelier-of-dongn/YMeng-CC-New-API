import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

import { catfkProductSchema, type CatFKProduct } from './catfk-schema'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: CatFKProduct | null
  products: CatFKProduct[]
  onSave: (product: CatFKProduct) => void
}
export function CatFKProductDialog(props: Props) {
  const { t } = useTranslation()
  const form = useForm<CatFKProduct>({
    resolver: zodResolver(catfkProductSchema),
    defaultValues: { id: '', name: '', goods_key: '', amount: 1 },
  })
  useEffect(() => {
    if (props.open) {
      form.reset(
        props.product ?? { id: '', name: '', goods_key: '', amount: 1 }
      )
    }
  }, [props.open, props.product, form])
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.product ? t('Edit product') : t('Add product')}
      description={t(
        'Selling prices come from live CatFK quotes. Each order buys one code.'
      )}
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button type='submit' form='catfk-product-form'>
            {t('Save')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id='catfk-product-form'
          className='space-y-4'
          onSubmit={(event) => {
            event.stopPropagation()
            void form.handleSubmit((product) => {
              if (
                !props.product &&
                props.products.some((item) => item.id === product.id)
              ) {
                form.setError('id', {
                  message: 'CatFK product IDs must be unique',
                })
                return
              }
              props.onSave(product)
              props.onOpenChange(false)
            })(event)
          }}
        >
          {(['id', 'name', 'goods_key'] as const).map((name) => (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t(
                      {
                        id: 'Stable product ID',
                        name: 'Product Name',
                        goods_key: 'CatFK goods key',
                      }[name]
                    )}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      disabled={name === 'id' && !!props.product}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
          <FormField
            control={form.control}
            name='amount'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Expected credited balance (USD)')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min='0'
                    max='1000000'
                    step='any'
                    {...field}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value === ''
                          ? Number.NaN
                          : Number(event.target.value)
                      )
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </Dialog>
  )
}
