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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { createInvoice } from '../api'
import { formatInvoiceAmount } from '../lib'
import { getInvoiceFormSchema, type InvoiceFormValues } from '../lib/schema'
import type { InvoiceEligibility } from '../types'

export function UserInvoiceForm(props: {
  eligibility: InvoiceEligibility
  selectedIds: Set<number>
  onSubmitted: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const selectedOrders = props.eligibility.orders.filter(
    (order) => props.selectedIds.has(order.id) && !order.invoice_status
  )
  const schema = getInvoiceFormSchema(t)
  const form = useForm<InvoiceFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', taxId: '' },
  })

  useEffect(() => {
    if (!props.eligibility.profile) return
    form.reset({
      title: props.eligibility.profile.title,
      taxId: props.eligibility.profile.tax_id,
    })
  }, [form, props.eligibility.profile])

  const selectedAmount = selectedOrders.reduce(
    (total, order) => total + order.amount,
    0
  )
  const refundAmount = useMemo(
    () =>
      props.eligibility.pending_refunds.reduce(
        (total, refund) => total + refund.amount,
        0
      ),
    [props.eligibility.pending_refunds]
  )
  const netAmount = selectedAmount - refundAmount
  const canSubmit =
    selectedOrders.length > 0 && netAmount > props.eligibility.minimum_amount

  const mutation = useMutation({
    mutationFn: async (values: InvoiceFormValues) => {
      if (!canSubmit) throw new Error(t('No invoiceable recharge orders'))
      const response = await createInvoice({
        title: values.title.trim(),
        tax_id: values.taxId.trim(),
        top_up_ids: selectedOrders.map((order) => order.id),
      })
      if (!response.success) throw new Error(response.message)
      return response.data
    },
    onSuccess: async () => {
      props.onSubmitted()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invoice-eligibility'] }),
        queryClient.invalidateQueries({ queryKey: ['user-invoices'] }),
      ])
      toast.success(t('Invoice application submitted'))
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('New invoice application')}</CardTitle>
        <CardDescription className='space-y-1'>
          <p>{t('The net invoice amount must be greater than 500.')}</p>
          <p>{t('Invoices are issued uniformly at the end of each month.')}</p>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className='space-y-5'
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='invoice-title'>{t('Invoice title')}</Label>
              <Input
                id='invoice-title'
                aria-invalid={Boolean(form.formState.errors.title)}
                {...form.register('title')}
              />
              {form.formState.errors.title && (
                <p className='text-destructive text-sm'>
                  {form.formState.errors.title.message}
                </p>
              )}
            </div>
            <div className='space-y-2'>
              <Label htmlFor='invoice-tax-id'>
                {t('Tax number / Unified Social Credit Code')}
              </Label>
              <Input
                id='invoice-tax-id'
                aria-invalid={Boolean(form.formState.errors.taxId)}
                {...form.register('taxId')}
              />
              {form.formState.errors.taxId && (
                <p className='text-destructive text-sm'>
                  {form.formState.errors.taxId.message}
                </p>
              )}
            </div>
          </div>

          <div className='bg-muted/30 grid gap-3 rounded-lg border p-4 sm:grid-cols-3'>
            <div>
              <p className='text-muted-foreground text-sm'>
                {t('Order amount')}
              </p>
              <p className='text-base font-semibold tabular-nums'>
                {formatInvoiceAmount(selectedAmount)}
              </p>
            </div>
            <div>
              <p className='text-muted-foreground text-sm'>
                {t('Refund deduction')}
              </p>
              <p className='text-base font-semibold tabular-nums'>
                -{formatInvoiceAmount(refundAmount)}
              </p>
            </div>
            <div>
              <p className='text-muted-foreground text-sm'>
                {t('Net invoice amount')}
              </p>
              <p className='text-base font-semibold tabular-nums'>
                {formatInvoiceAmount(netAmount)}
              </p>
            </div>
          </div>

          <div className='flex justify-end'>
            <Button type='submit' disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending
                ? t('Submitting...')
                : t('Submit invoice application')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
