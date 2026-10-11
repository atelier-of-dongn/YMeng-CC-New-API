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
import { MessageSquare, ShieldAlert, Sparkles, Terminal } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldTitle } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

import {
  getLastBaoCodeProtocol,
  setLastBaoCodeProtocol,
  type BaoCodeProtocol,
} from '../lib/baocode-import'

const PROTOCOL_OPTIONS = [
  {
    value: 'openai-chat',
    labelKey: 'OpenAI Chat Completions',
    path: '/v1/chat/completions',
    icon: MessageSquare,
  },
  {
    value: 'openai-responses',
    labelKey: 'OpenAI Responses',
    path: '/v1/responses',
    icon: Sparkles,
  },
  {
    value: 'anthropic',
    labelKey: 'Anthropic Messages',
    path: '/v1/messages',
    icon: Terminal,
  },
] as const satisfies ReadonlyArray<{
  value: BaoCodeProtocol
  labelKey: string
  path: string
  icon: typeof MessageSquare
}>

const valueBoxClassName =
  'bg-muted/50 min-w-0 rounded-md border px-3 py-2 font-mono text-xs leading-relaxed break-all'

type BaoCodeImportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  url: string
  isImporting: boolean
  onImport: (protocol: BaoCodeProtocol) => Promise<boolean>
}

export function BaoCodeImportDialog(props: BaoCodeImportDialogProps) {
  const { t } = useTranslation()
  const protocolGroupId = useId()
  const [protocol, setProtocol] = useState<BaoCodeProtocol>(
    getLastBaoCodeProtocol
  )

  useEffect(() => {
    if (props.open) setProtocol(getLastBaoCodeProtocol())
  }, [props.open])

  const handleProtocolChange = (value: string) => {
    const next = value as BaoCodeProtocol
    setLastBaoCodeProtocol(next)
    setProtocol(next)
  }

  const handleImport = async () => {
    const imported = await props.onImport(protocol)
    if (imported) props.onOpenChange(false)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Import to BaoCode')}
      description={t(
        'Choose a protocol before sending this API key to BaoCode. The full key will be included in the import link.'
      )}
      contentClassName='sm:max-w-md'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={props.isImporting}
          >
            {t('Cancel')}
          </Button>
          <Button onClick={handleImport} disabled={props.isImporting}>
            {props.isImporting ? <Spinner data-icon='inline-start' /> : null}
            {t('Import')}
          </Button>
        </>
      }
    >
      <Field>
        <FieldTitle id={`${protocolGroupId}-label`}>{t('Protocol')}</FieldTitle>
        <RadioGroup
          value={protocol}
          onValueChange={handleProtocolChange}
          aria-labelledby={`${protocolGroupId}-label`}
          className='grid gap-2'
        >
          {PROTOCOL_OPTIONS.map((option) => {
            const Icon = option.icon
            const optionId = `${protocolGroupId}-${option.value}`
            return (
              <Label
                key={option.value}
                htmlFor={optionId}
                className={cn(
                  'group bg-card border-muted hover:border-primary/40 focus-within:border-primary/50 has-data-[checked]:border-primary has-data-[checked]:ring-primary/20 flex cursor-pointer items-center gap-3 rounded-xl border p-3 font-normal transition-all has-data-[checked]:ring-2'
                )}
              >
                <RadioGroupItem
                  id={optionId}
                  value={option.value}
                  aria-label={t(option.labelKey)}
                />
                <Icon
                  aria-hidden='true'
                  className='text-muted-foreground/70 group-hover:text-primary group-has-data-[checked]:text-primary size-4 shrink-0 transition-colors'
                />
                <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
                  <span className='truncate text-sm font-medium'>
                    {t(option.labelKey)}
                  </span>
                  <span className='text-muted-foreground truncate font-mono text-xs'>
                    {option.path}
                  </span>
                </span>
              </Label>
            )
          })}
        </RadioGroup>
      </Field>

      <Field>
        <FieldTitle>{t('Name')}</FieldTitle>
        <span className={cn(valueBoxClassName, 'flex-1')}>{props.name}</span>
      </Field>

      <Field>
        <FieldTitle>{t('API URL')}</FieldTitle>
        <span className='flex min-w-0 items-start gap-1.5'>
          <span className={valueBoxClassName}>{props.url}</span>
          <CopyButton
            value={props.url}
            className='size-7 shrink-0'
            iconClassName='size-3.5'
            tooltip={t('Copy URL')}
            aria-label={t('Copy URL')}
          />
        </span>
      </Field>

      <Alert>
        <ShieldAlert aria-hidden='true' />
        <AlertTitle>
          {t('The full API key is included in the import link')}
        </AlertTitle>
        <AlertDescription>
          {t(
            'It travels in the URL fragment, which stays in your browser and is never sent in the server request.'
          )}
        </AlertDescription>
      </Alert>
    </Dialog>
  )
}
