import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { formatCurrency } from '../lib'

// The fee CatFK adds to the goods price, shown under a payment amount.
export function CatfkFeeNote(props: { fee?: number; feeRate?: number }) {
  const { t, i18n } = useTranslation()
  if (
    props.fee === undefined ||
    props.feeRate === undefined ||
    !Number.isFinite(props.fee) ||
    !Number.isFinite(props.feeRate) ||
    props.fee <= 0
  ) {
    return null
  }
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return (
    <span className='text-muted-foreground text-xs'>
      {t('Includes a {{rate}}% fee ({{fee}})', {
        rate: formatNumber(props.feeRate, locale),
        fee: formatCurrency(props.fee),
      })}
    </span>
  )
}
