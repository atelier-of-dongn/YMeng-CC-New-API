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
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'

import { getInvoiceRejectSchema, type InvoiceRejectValues } from '../lib/schema'

export function RejectInvoiceDialog(props: {
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onReject: (reason: string) => void
}) {
  const { t } = useTranslation()
  const form = useForm<InvoiceRejectValues>({
    resolver: zodResolver(getInvoiceRejectSchema(t)),
    defaultValues: { reason: '' },
  })

  const handleOpenChange = (open: boolean) => {
    if (!open) form.reset()
    props.onOpenChange(open)
  }

  const handleSubmit = (values: InvoiceRejectValues) => {
    props.onReject(values.reason.trim())
  }

  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Reject invoice application')}</DialogTitle>
          <DialogDescription>
            {t(
              'The application will be rejected and its orders will become available for a new application.'
            )}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)}>
            <FormField
              control={form.control}
              name='reason'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Rejection reason')}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={5}
                      disabled={props.pending}
                      placeholder={t('Please enter the rejection reason')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                disabled={props.pending}
                onClick={() => handleOpenChange(false)}
              >
                {t('Cancel')}
              </Button>
              <Button
                type='submit'
                variant='destructive'
                disabled={props.pending}
              >
                {props.pending ? <Spinner data-icon='inline-start' /> : null}
                {props.pending ? t('Rejecting...') : t('Reject invoice')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
