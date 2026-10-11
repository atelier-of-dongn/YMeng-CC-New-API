import { useEffect, useState } from 'react'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import type { BaoCodeProtocol } from '../lib/baocode-import'

const protocols: BaoCodeProtocol[] = [
  'openai-chat',
  'openai-responses',
  'anthropic',
]

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
  const [protocol, setProtocol] = useState<BaoCodeProtocol>('openai-chat')

  useEffect(() => {
    if (props.open) setProtocol('openai-chat')
  }, [props.open])

  const protocolLabels: Record<BaoCodeProtocol, string> = {
    anthropic: t('Anthropic Messages'),
    'openai-chat': t('OpenAI Chat Completions'),
    'openai-responses': t('OpenAI Responses'),
  }

  const handleImport = async () => {
    const imported = await props.onImport(protocol)
    if (imported) props.onOpenChange(false)
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Import to BaoCode')}</DialogTitle>
          <DialogDescription>
            {t(
              'Choose a protocol before sending this API key to BaoCode. The full key will be included in the import link.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-4'>
          <div className='grid gap-1.5'>
            <Label>{t('Name')}</Label>
            <div className='bg-muted/50 rounded-md px-3 py-2 text-sm break-all'>
              {props.name}
            </div>
          </div>
          <div className='grid gap-1.5'>
            <Label>{t('API URL')}</Label>
            <div className='bg-muted/50 rounded-md px-3 py-2 font-mono text-xs break-all'>
              {props.url}
            </div>
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='baocode-protocol'>{t('Protocol')}</Label>
            <Select
              value={protocol}
              onValueChange={(value) => setProtocol(value as BaoCodeProtocol)}
            >
              <SelectTrigger id='baocode-protocol' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {protocols.map((value) => (
                  <SelectItem key={value} value={value}>
                    {protocolLabels[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={props.isImporting}
          >
            {t('Cancel')}
          </Button>
          <Button onClick={handleImport} disabled={props.isImporting}>
            {props.isImporting ? t('Loading...') : t('Import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
