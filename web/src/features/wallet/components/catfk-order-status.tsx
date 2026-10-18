import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'

export function CatfkOrderStatus(props: { status: string | null }) {
  const { t } = useTranslation()
  if (!props.status) return null
  const labels: Record<string, string> = {
    new: t('Catfk order created'),
    submitting: t('Catfk order is being submitted'),
    creation_unknown: t(
      'Catfk order creation is uncertain. Contact support before creating another order.'
    ),
    pending: t('Catfk payment is pending'),
    paid: t('Catfk payment received. Wallet credit is pending.'),
    needs_attention: t('Catfk order needs attention. Contact support.'),
    completed: t('Catfk wallet credit completed'),
    expired: t('Catfk order expired'),
  }
  return (
    <Alert>
      <AlertDescription role='status'>
        {labels[props.status] || t('Catfk order status is unavailable')}
      </AlertDescription>
    </Alert>
  )
}
