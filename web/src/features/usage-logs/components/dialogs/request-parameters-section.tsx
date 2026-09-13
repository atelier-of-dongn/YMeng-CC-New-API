import { Check, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

import type { LogRequestParameters } from '../../types'

export function RequestParametersSection(props: {
  requestParameters?: LogRequestParameters | null
}) {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard()
  const request = props.requestParameters
  if (!request) return null

  const json = JSON.stringify(request.parameters, null, 2)

  return (
    <details className='bg-muted/30 min-w-0 rounded-md border p-2.5'>
      <summary className='focus-visible:outline-ring cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-2'>
        {t('Request Parameters')}
      </summary>
      <div className='mt-2 min-w-0 space-y-2'>
        {request.truncated && (
          <p role='note' className='text-warning text-xs'>
            {t(
              'Request parameters were truncated. This is not the complete request.'
            )}
          </p>
        )}
        {request.omitted && (
          <p role='note' className='text-warning text-xs'>
            {t('Some request parameters were omitted from this log.')}
          </p>
        )}
        {json !== undefined && (
          <>
            <div className='flex justify-end'>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => copyToClipboard(json)}
              >
                {copiedText === json ? (
                  <Check className='text-success size-3.5' aria-hidden='true' />
                ) : (
                  <Copy className='size-3.5' aria-hidden='true' />
                )}
                {t('Copy to clipboard')}
              </Button>
            </div>
            <pre className='bg-background max-h-64 min-w-0 overflow-auto rounded-md border p-2 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap'>
              {json}
            </pre>
          </>
        )}
      </div>
    </details>
  )
}
