import { CheckCircle2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-mobile'
import { toIntlLocale } from '@/i18n/languages'
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { safeCatfkQrCode } from '../../catfk-api'
import type { CatfkPaymentStatusOrder } from '../../types'
import { CatfkOrderStatus } from '../catfk-order-status'

export function CatfkPaymentStatusDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  order: CatfkPaymentStatusOrder | null
  queryFailed: boolean
}) {
  const { t, i18n } = useTranslation()
  const isMobile = useIsMobile()
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
  // While waiting the dialog holds only the amount, the code and a cancel.
  if (waiting) {
    title = t('Scan with Alipay to pay')
  } else if (completed) {
    title = t('Payment successful')
  } else if (props.order.status === 'paid') {
    title = t('Payment received. Wallet credit is pending.')
  } else if (props.order.status === 'expired') {
    title = t('Order expired')
  } else if (props.order.status === 'needs_attention') {
    title = t('Order needs attention. Contact support.')
  }
  const qrCode = waiting ? safeCatfkQrCode(props.order.paymentQrCode) : null
  // On a phone the code cannot be scanned from its own screen. Only a real
  // Alipay code may be opened; the fallback payment URL returns to catfk.
  const alipayLink =
    isMobile && qrCode && new URL(qrCode).hostname === 'qr.alipay.com'
      ? qrCode
      : null

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={title}
      showCloseButton={false}
      contentClassName='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-md'
      bodyClassName='space-y-4'
      footer={
        <Button
          variant={waiting ? 'outline' : 'default'}
          onClick={() => props.onOpenChange(false)}
        >
          {waiting ? t('Cancel payment') : t('Close')}
        </Button>
      }
    >
      <div className='flex items-center justify-between gap-3'>
        <span className='text-muted-foreground text-sm'>
          {t('Topup Amount')}
        </span>
        <span className='text-lg font-semibold break-all'>{amount}</span>
      </div>
      {completed && (
        <p role='status' className='flex items-start gap-2 text-sm'>
          <CheckCircle2
            className='text-success size-5 shrink-0'
            aria-hidden='true'
          />
          {t('Automatically credited {{amount}}. No redemption needed.', {
            amount,
          })}
        </p>
      )}
      {waiting && qrCode && (
        <div className='flex flex-col items-center gap-3'>
          <div className='rounded-lg bg-white p-3'>
            <QRCodeSVG
              value={qrCode}
              size={180}
              role='img'
              aria-label={t('Payment QR code')}
            />
          </div>
          {alipayLink && (
            <Button
              className='w-full'
              render={
                <a
                  href={alipayLink}
                  target='_blank'
                  rel='noopener noreferrer'
                />
              }
            >
              {t('Open Alipay to pay')}
            </Button>
          )}
        </div>
      )}
      {!completed && !waiting && (
        <>
          <CatfkOrderStatus status={props.order.status} />
          {props.queryFailed && (
            <p role='status' className='text-muted-foreground text-xs'>
              {t('Unable to check payment status. Retrying automatically.')}
            </p>
          )}
        </>
      )}
    </Dialog>
  )
}
