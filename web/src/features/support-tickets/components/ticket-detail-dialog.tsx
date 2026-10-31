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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { RichContent } from '@/components/rich-content'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  downloadSupportTicketAttachment,
  fetchSupportTicketAttachment,
  getSupportTicket,
  replySupportTicket,
} from '../api'
import { MAX_TICKET_CONTENT_LENGTH } from '../constants'
import { formatSupportTicketTime } from '../lib/format'
import {
  replySupportTicketSchema,
  type ReplySupportTicketValues,
} from '../lib/schema'
import type { SupportTicketScope } from '../types'
import { TicketStatusBadge } from './ticket-status-badge'

export function TicketDetailDialog(props: {
  id: number
  scope: SupportTicketScope
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const detail = useQuery({
    queryKey: ['support-ticket', props.scope, props.id],
    queryFn: async ({ signal }) =>
      requireServerSuccess(
        await getSupportTicket(props.id, props.scope, signal)
      ).data,
    meta: { errorToast: false },
  })
  const form = useForm<ReplySupportTicketValues>({
    resolver: zodResolver(replySupportTicketSchema),
    defaultValues: { content: '' },
  })
  useEffect(() => {
    form.reset({ content: '' })
  }, [form, props.id])
  const reply = useMutation({
    mutationFn: async (values: ReplySupportTicketValues) => {
      requireServerSuccess(
        await replySupportTicket(props.id, props.scope, values.content)
      )
    },
    onSuccess: async () => {
      form.reset({ content: '' })
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['support-ticket', props.scope, props.id],
        }),
        queryClient.invalidateQueries({ queryKey: ['support-tickets'] }),
      ])
      toast.success(t('Reply sent'))
    },
    onError: (error) => handleServerError(error, t('Failed to send reply')),
  })
  const attachment = useQuery({
    queryKey: ['support-ticket-attachment', props.scope, props.id],
    queryFn: async ({ signal }) => {
      const blob = await fetchSupportTicketAttachment(
        props.id,
        props.scope,
        signal
      )
      return { blob, text: await blob.text() }
    },
    enabled: Boolean(detail.data?.has_attachment),
    gcTime: 0,
    staleTime: 0,
    retry: false,
    meta: { errorToast: false },
  })
  const download = useMutation({
    mutationFn: async () => {
      const blob =
        attachment.data?.blob ??
        (await fetchSupportTicketAttachment(props.id, props.scope))
      downloadSupportTicketAttachment(
        blob,
        detail.data?.messages?.find((message) => message.has_attachment)
          ?.attachment_name || `ticket-${props.id}.md`
      )
    },
    onError: (error) =>
      handleServerError(error, t('Failed to download attachment')),
  })

  let content: React.ReactNode
  if (detail.isLoading) {
    content = <LoadingState message={t('Loading ticket...')} />
  } else if (detail.isError || !detail.data) {
    content = (
      <ErrorState
        title={t('Failed to load support ticket')}
        onRetry={() => detail.refetch()}
      />
    )
  } else {
    const ticket = detail.data
    content = (
      <div className='space-y-5'>
        <div className='flex flex-wrap items-center gap-2'>
          <TicketStatusBadge status={ticket.status} />
          <span className='text-muted-foreground text-sm'>
            {t('Ticket #{{id}}', { id: ticket.id })}
          </span>
          {props.scope === 'admin' ? (
            <span className='text-muted-foreground text-sm'>
              {ticket.username}
            </span>
          ) : null}
        </div>
        {ticket.request_id ? (
          <section className='space-y-2 rounded-md border p-3'>
            <h3 className='text-sm font-medium'>{t('Request information')}</h3>
            <div className='grid gap-2 text-sm sm:grid-cols-2'>
              <div className='sm:col-span-2'>
                <span className='text-muted-foreground'>
                  {t('Request ID')}:{' '}
                </span>
                <span className='font-mono break-all'>{ticket.request_id}</span>
              </div>
              {ticket.request_log ? (
                <>
                  <div>
                    <span className='text-muted-foreground'>
                      {t('Model')}:{' '}
                    </span>
                    {ticket.request_log.model_name || '-'}
                  </div>
                  <div>
                    <span className='text-muted-foreground'>{t('Time')}: </span>
                    {formatSupportTicketTime(ticket.request_log.created_at)}
                  </div>
                  <div className='sm:col-span-2'>
                    <span className='text-muted-foreground'>{t('Type')}: </span>
                    {ticket.request_log.type}
                  </div>
                  {ticket.request_log.content ? (
                    <div className='sm:col-span-2'>
                      <p className='text-muted-foreground'>
                        {t('Log details')}
                      </p>
                      <p className='break-words whitespace-pre-wrap'>
                        {ticket.request_log.content}
                      </p>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className='text-muted-foreground sm:col-span-2'>
                  {t('The request log is no longer available.')}
                </p>
              )}
            </div>
          </section>
        ) : null}
        <section className='space-y-3' aria-label={t('Conversation')}>
          <h3 className='text-sm font-medium'>{t('Conversation')}</h3>
          {(ticket.messages ?? []).map((message) => (
            <article
              key={message.id}
              className='space-y-2 rounded-md border p-3'
            >
              <header className='flex flex-wrap items-center justify-between gap-2 text-xs'>
                <div className='flex items-center gap-2'>
                  <span className='font-medium'>{message.author_username}</span>
                  <Badge variant='outline'>
                    {message.role === 'admin' ? t('Admin') : t('User')}
                  </Badge>
                </div>
                <time className='text-muted-foreground'>
                  {formatSupportTicketTime(message.created_at)}
                </time>
              </header>
              <p className='text-sm break-words whitespace-pre-wrap'>
                {message.content}
              </p>
              {message.has_attachment ? (
                <div className='flex flex-wrap items-center gap-2 text-sm'>
                  <span className='break-all'>{message.attachment_name}</span>
                  {message.attachment_size ? (
                    <span className='text-muted-foreground'>
                      ({message.attachment_size} B)
                    </span>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </section>
        {ticket.has_attachment ? (
          <section className='space-y-2 rounded-md border p-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <h3 className='text-sm font-medium'>
                {t('Markdown attachment')}
              </h3>
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={download.isPending}
                onClick={() => download.mutate()}
              >
                <Download data-icon='inline-start' aria-hidden='true' />
                {download.isPending ? t('Downloading...') : t('Download')}
              </Button>
            </div>
            {attachment.isLoading ? (
              <LoadingState
                inline
                message={t('Loading attachment preview...')}
              />
            ) : null}
            {attachment.isError ? (
              <div role='alert' className='space-y-2 text-sm'>
                <p>{t('Failed to load attachment preview')}</p>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => attachment.refetch()}
                >
                  {t('Retry')}
                </Button>
              </div>
            ) : null}
            {attachment.data ? (
              <RichContent
                content={attachment.data.text}
                className='max-h-80 overflow-auto rounded-md border p-3'
              />
            ) : null}
          </section>
        ) : null}
        <Form {...form}>
          <form
            className='space-y-3'
            onSubmit={form.handleSubmit((values) => reply.mutate(values))}
          >
            <FormField
              control={form.control}
              name='content'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Reply')}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={4}
                      maxLength={MAX_TICKET_CONTENT_LENGTH}
                      placeholder={t('Continue the conversation...')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className='flex justify-end'>
              <Button type='submit' disabled={reply.isPending}>
                {reply.isPending ? t('Sending...') : t('Send reply')}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    )
  }

  return (
    <Dialog
      open
      onOpenChange={props.onOpenChange}
      title={t('Support ticket details')}
      contentClassName='sm:max-w-3xl'
      contentHeight='75vh'
      footer={
        <Button variant='outline' onClick={() => props.onOpenChange(false)}>
          {t('Close')}
        </Button>
      }
    >
      {content}
    </Dialog>
  )
}
