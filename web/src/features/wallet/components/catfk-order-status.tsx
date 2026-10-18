import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'

export function CatfkOrderStatus(props: { status: string | null }) {
  const { t } = useTranslation()
  if (!props.status) return null
  const labels: Record<string, string> = {
    new: t('Order created'),
    submitting: t('Submitting order'),
    creation_unknown: t(
      'Order creation is uncertain. Contact support before creating another order.'
    ),
    pending: t('Payment is pending'),
    paid: t('Payment received. Wallet credit is pending.'),
    needs_attention: t('Order needs attention. Contact support.'),
    completed: t('Wallet credit completed'),
    expired: t('Order expired'),
  }
  return (
    <Alert>
      <AlertDescription role='status'>
        {labels[props.status] || t('Order status is unavailable')}
      </AlertDescription>
    </Alert>
  )
}
