import { CheckCircle2, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { safeCatfkPaymentUrl } from '../../catfk-api'
import type { CatfkPaymentStatusOrder } from '../../types'
import { CatfkOrderStatus } from '../catfk-order-status'

export function CatfkPaymentStatusDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  order: CatfkPaymentStatusOrder | null
  checking: boolean
  queryFailed: boolean
  onCheck: () => void
}) {
  const { t, i18n } = useTranslation()
  useSystemConfigStore((state) => state.config.currency)
  if (!props.order) return null
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const amount = formatBillingCurrencyFromUSD(props.order.amount, {
    digitsLarge: 2,
    digitsSmall: 2,
    abbreviate: false,
    locale,
  })
  const completed = props.order.status === 'completed'
  const waiting =
    props.order.status === 'pending' || props.order.status === 'new'
  let title = t('Waiting for payment confirmation')
  if (completed) {
    title = t('Payment successful')
  } else if (props.order.status === 'paid') {
    title = t('Payment received. Wallet credit is pending.')
  } else if (props.order.status === 'expired') {
    title = t('Order expired')
  } else if (props.order.status === 'needs_attention') {
    title = t('Order needs attention. Contact support.')
  }
  const url = waiting ? safeCatfkPaymentUrl(props.order.paymentUrl) : null

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={title}
      description={t('Review your payment details')}
      showCloseButton={false}
      contentClassName='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-md'
      bodyClassName='space-y-4'
      footer={
        <>
          {!completed && (
            <Button
              variant='outline'
              onClick={props.onCheck}
              disabled={props.checking}
            >
              {t('Check status')}
            </Button>
          )}
          <Button onClick={() => props.onOpenChange(false)}>
            {t('Close')}
          </Button>
        </>
      }
    >
      <div className='flex items-center justify-between gap-3'>
        <span className='text-muted-foreground text-sm'>
          {t('Topup Amount')}
        </span>
        <span className='text-lg font-semibold break-all'>{amount}</span>
      </div>
      {completed ? (
        <p role='status' className='flex items-start gap-2 text-sm'>
          <CheckCircle2
            className='text-success size-5 shrink-0'
            aria-hidden='true'
          />
          {t('Automatically credited {{amount}}. No redemption needed.', {
            amount,
          })}
        </p>
      ) : (
        <>
          {waiting ? (
            <p role='status' className='flex items-center gap-2 text-sm'>
              <Loader2
                className='size-4 shrink-0 animate-spin'
                aria-hidden='true'
              />
              {t('Waiting for payment confirmation')}
            </p>
          ) : (
            <CatfkOrderStatus status={props.order.status} />
          )}
          {props.queryFailed && (
            <p role='status' className='text-muted-foreground text-xs'>
              {t('Unable to check payment status. Retrying automatically.')}
            </p>
          )}
          {url && (
            <a
              className='text-primary focus-visible:ring-ring block max-w-full rounded text-xs break-words underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none'
              href={url}
              target='_blank'
              rel='noopener noreferrer'
            >
              {t('Click here if payment did not open')}
            </a>
          )}
        </>
      )}
    </Dialog>
  )
}
