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
import { FileText, List, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { RichContent } from '@/components/rich-content'
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
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { createSupportTicket } from '../api'
import { MAX_TICKET_CONTENT_LENGTH } from '../constants'
import {
  createSupportTicketSchema,
  readMarkdownFile,
  type CreateSupportTicketValues,
} from '../lib/schema'
import { RequestLogSelector } from './request-log-selector'

export function CreateTicketDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (id: number) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [showLogs, setShowLogs] = useState(false)
  const [preview, setPreview] = useState(false)
  const [markdown, setMarkdown] = useState('')
  const form = useForm<CreateSupportTicketValues>({
    resolver: zodResolver(createSupportTicketSchema),
    defaultValues: { content: '', requestId: '', file: null },
  })
  const file = form.watch('file')
  const create = useMutation({
    mutationFn: async (values: CreateSupportTicketValues) =>
      requireServerSuccess(await createSupportTicket(values)).data,
    onSuccess: async (ticket) => {
      await queryClient.invalidateQueries({ queryKey: ['support-tickets'] })
      props.onOpenChange(false)
      props.onCreated(ticket.id)
      toast.success(t('Support ticket created'))
    },
    onError: (error) =>
      handleServerError(error, t('Failed to create support ticket')),
  })

  useEffect(() => {
    if (!file) {
      setMarkdown('')
      setPreview(false)
      return
    }
    let active = true
    readMarkdownFile(file)
      .then((text) => {
        if (active) setMarkdown(text)
      })
      .catch((error: unknown) => {
        if (!active) return
        setMarkdown('')
        setPreview(false)
        form.setError('file', {
          message:
            error instanceof Error ? error.message : 'Invalid Markdown file.',
        })
      })
    return () => {
      active = false
    }
  }, [file, form])

  const handleOpenChange = (open: boolean) => {
    if (create.isPending) return
    if (!open) {
      form.reset()
      setShowLogs(false)
    }
    props.onOpenChange(open)
  }

  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={handleOpenChange}
        showCloseButton={!create.isPending}
        title={t('New support ticket')}
        description={t(
          'Provide feedback, a request ID, or a Markdown file. You can combine them.'
        )}
        contentHeight='65vh'
        footer={
          <>
            <Button
              type='button'
              variant='outline'
              disabled={create.isPending}
              onClick={() => handleOpenChange(false)}
            >
              {t('Cancel')}
            </Button>
            <Button
              type='submit'
              form='create-support-ticket'
              disabled={create.isPending}
            >
              {create.isPending ? t('Submitting...') : t('Create ticket')}
            </Button>
          </>
        }
      >
        <Form {...form}>
          <form
            id='create-support-ticket'
            className='space-y-5'
            onSubmit={form.handleSubmit((values) => create.mutate(values))}
          >
            <FormField
              control={form.control}
              name='content'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Feedback')}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={7}
                      disabled={create.isPending}
                      maxLength={MAX_TICKET_CONTENT_LENGTH}
                      placeholder={t('Describe the issue or your feedback.')}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Up to 20,000 characters. Feedback is optional.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='requestId'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Request ID')}</FormLabel>
                  <div className='flex gap-2'>
                    <FormControl>
                      <Input
                        {...field}
                        disabled={create.isPending}
                        className='min-w-0 flex-1'
                        placeholder={t('Enter a request ID (optional)')}
                      />
                    </FormControl>
                    <Button
                      type='button'
                      variant='outline'
                      disabled={create.isPending}
                      onClick={() => setShowLogs(true)}
                    >
                      <List data-icon='inline-start' aria-hidden='true' />
                      {t('Select log')}
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='file'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Markdown attachment')}</FormLabel>
                  <FormControl>
                    <Input
                      ref={fileInput}
                      type='file'
                      disabled={create.isPending}
                      accept='.md,.markdown,text/markdown'
                      name={field.name}
                      onBlur={field.onBlur}
                      onChange={(event) => {
                        field.onChange(event.target.files?.[0] ?? null)
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('One .md or .markdown file, up to 1 MiB.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {file ? (
              <div className='space-y-2 rounded-md border p-3'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <div className='flex min-w-0 items-center gap-2 text-sm'>
                    <FileText className='size-4 shrink-0' aria-hidden='true' />
                    <span className='truncate'>{file.name}</span>
                  </div>
                  <div className='flex gap-2'>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      disabled={!markdown}
                      onClick={() => setPreview((value) => !value)}
                    >
                      {preview ? t('Hide preview') : t('Preview')}
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      aria-label={t('Remove attachment')}
                      onClick={() => {
                        form.setValue('file', null, { shouldValidate: true })
                        if (fileInput.current) fileInput.current.value = ''
                      }}
                    >
                      <X aria-hidden='true' />
                    </Button>
                  </div>
                </div>
                {preview && markdown ? (
                  <RichContent
                    content={markdown}
                    className='max-h-72 overflow-auto rounded-md border p-3'
                  />
                ) : null}
              </div>
            ) : null}
          </form>
        </Form>
      </Dialog>
      <RequestLogSelector
        open={showLogs}
        onOpenChange={setShowLogs}
        onSelect={(requestId) =>
          form.setValue('requestId', requestId, { shouldValidate: true })
        }
      />
    </>
  )
}
