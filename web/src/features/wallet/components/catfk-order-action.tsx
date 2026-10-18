import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { handleServerError } from '@/lib/handle-server-error'

import { getCatfkOrder, safeCatfkPaymentUrl } from '../catfk-api'
import { CatfkOrderStatus } from './catfk-order-status'

export function CatfkOrderAction(props: {
  tradeNo: string
  onCompleted?: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: getCatfkOrder,
    meta: { errorToast: false },
    retry: false,
  })
  async function resume() {
    try {
      const order = await mutation.mutateAsync(props.tradeNo)
      if (
        order.trade_no !== props.tradeNo ||
        typeof order.status !== 'string'
      ) {
        throw new Error(t('Invalid payment response'))
      }
      setStatus(order.status)
      if (order.status === 'completed') await props.onCompleted?.()
      const url = safeCatfkPaymentUrl(order.payment_url)
      if (order.status === 'pending' && url) window.location.assign(url)
    } catch (error) {
      handleServerError(error, t('Payment request failed'))
    }
  }
  return (
    <div className='mt-3 space-y-2'>
      <CatfkOrderStatus status={status} />
      <Button variant='outline' disabled={mutation.isPending} onClick={resume}>
        {t('Resume Catfk payment')}
      </Button>
    </div>
  )
}
