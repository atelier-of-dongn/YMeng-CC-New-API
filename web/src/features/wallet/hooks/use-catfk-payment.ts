import { useMutation, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { handleServerError } from '@/lib/handle-server-error'

import {
  getCatfkOrder,
  isValidCatfkQQ,
  isValidCatfkQuote,
  payCatfk,
  quoteCatfk,
  safeCatfkQrCode,
} from '../catfk-api'
import type {
  CatfkChannel,
  CatfkInfo,
  CatfkProduct,
  CatfkPaymentStatusOrder,
  CatfkQuote,
} from '../types'

const finalStatuses = new Set(['completed', 'expired', 'needs_attention'])

// For the user an order lasts only while its payment dialog is open. Closing
// the dialog ends it; the server keeps settling or expiring the real order,
// and a later purchase always creates a new one. An unpaid order costs
// nothing, so no local record guards against creating another.
export function useCatfkPayment(
  info: CatfkInfo | undefined,
  userId?: number,
  onCompleted?: () => Promise<void>
) {
  const { t } = useTranslation()
  const [channel, setChannel] = useState<CatfkChannel | null>(null)
  const [product, setProduct] = useState<CatfkProduct | null>(null)
  const [quote, setQuote] = useState<CatfkQuote | null>(null)
  const [qq, setQQ] = useState('')
  const [open, setOpen] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [statusOrder, setStatusOrder] =
    useState<CatfkPaymentStatusOrder | null>(null)
  const generation = useRef(0)
  const identity = useRef(userId)
  identity.current = userId
  const inFlight = useRef(false)
  // One key per confirmation, so retrying a lost response reuses its order.
  const requestKey = useRef<string | null>(null)
  const creditedTrade = useRef<string | null>(null)
  const quoteMutation = useMutation({
    mutationFn: quoteCatfk,
    meta: { errorToast: false },
    retry: false,
  })
  const payMutation = useMutation({
    mutationFn: payCatfk,
    meta: { errorToast: false },
    retry: false,
  })

  useEffect(() => {
    generation.current++
    inFlight.current = false
    requestKey.current = null
    setChannel(null)
    setProduct(null)
    setQuote(null)
    setQQ('')
    setOpen(false)
    setCalculating(false)
    setStatusOrder(null)
  }, [userId])

  function reset() {
    if (inFlight.current) return
    generation.current++
    setOpen(false)
    setQQ('')
    setQuote(null)
    setCalculating(false)
    requestKey.current = null
  }

  function selectChannel(next: CatfkChannel | null) {
    if (inFlight.current) return
    reset()
    setChannel(next)
    setProduct(null)
  }

  async function selectProduct(next: CatfkProduct, selectedChannel = channel) {
    if (inFlight.current) return
    reset()
    setStatusOrder(null)
    setChannel(selectedChannel)
    setProduct(next)
    if (!userId || !selectedChannel || !info?.enabled || !info.available) return
    const version = generation.current
    setOpen(true)
    setCalculating(true)
    try {
      const result = await quoteMutation.mutateAsync({
        product_id: next.id,
        channel_id: selectedChannel.id,
      })
      if (version !== generation.current || identity.current !== userId) return
      if (!isValidCatfkQuote(result, next.amount)) {
        throw new Error(t('Invalid payment quote'))
      }
      setQuote(result)
    } catch (error) {
      if (version === generation.current && identity.current === userId) {
        handleServerError(error, t('Payment request failed'))
      }
    } finally {
      if (version === generation.current && identity.current === userId) {
        setCalculating(false)
      }
    }
  }

  async function confirm() {
    if (
      inFlight.current ||
      !userId ||
      !open ||
      !info?.enabled ||
      !info.available ||
      !channel ||
      !product ||
      !isValidCatfkQQ(qq) ||
      !isValidCatfkQuote(quote, product.amount)
    ) {
      return
    }
    const version = generation.current
    requestKey.current ??= crypto.randomUUID()
    inFlight.current = true
    try {
      const order = await payMutation.mutateAsync({
        product_id: product.id,
        channel_id: channel.id,
        quote_id: quote.quote_id,
        qq,
        idempotency_key: requestKey.current,
      })
      if (version !== generation.current || identity.current !== userId) return
      if (
        typeof order.trade_no !== 'string' ||
        !order.trade_no ||
        typeof order.status !== 'string'
      ) {
        throw new Error(t('Invalid payment response'))
      }
      setStatusOrder({
        tradeNo: order.trade_no,
        amount: product.amount,
        status: order.status,
        paymentQrCode:
          order.status === 'pending'
            ? safeCatfkQrCode(order.payment_qr_code)
            : null,
      })
      inFlight.current = false
      reset()
    } catch (error) {
      if (version === generation.current && identity.current === userId) {
        handleServerError(error, t('Payment request failed'))
      }
    } finally {
      if (version === generation.current && identity.current === userId) {
        inFlight.current = false
      }
    }
  }

  const closeStatus = useCallback(() => setStatusOrder(null), [])

  const trade = statusOrder?.tradeNo ?? null
  const trackedOrder = useQuery({
    queryKey: ['wallet', 'store-order', userId, trade],
    queryFn: () => getCatfkOrder(trade ?? ''),
    enabled:
      !!trade && !!userId && !finalStatuses.has(statusOrder?.status ?? ''),
    refetchInterval: 5000,
    refetchOnWindowFocus: 'always',
    refetchIntervalInBackground: true,
    retry: false,
    meta: { errorToast: false },
  })
  const refetchOrder = trackedOrder.refetch
  // Returning from the Alipay tab or app checks the order at once.
  useEffect(() => {
    if (!trade || finalStatuses.has(statusOrder?.status ?? '')) return
    const check = () => void refetchOrder({ cancelRefetch: false })
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [trade, statusOrder?.status, refetchOrder])
  useEffect(() => {
    const order = trackedOrder.data
    if (
      !order ||
      order.trade_no !== trade ||
      typeof order.status !== 'string'
    ) {
      return
    }
    setStatusOrder((current) =>
      current?.tradeNo === order.trade_no
        ? {
            ...current,
            status: order.status,
            paymentQrCode:
              order.status === 'pending' ? current.paymentQrCode : null,
          }
        : current
    )
    if (order.status !== 'completed' || creditedTrade.current === trade) return
    creditedTrade.current = trade
    void onCompleted?.().catch((error: unknown) => {
      handleServerError(error, t('Failed to refresh user information'))
    })
  }, [trackedOrder.data, trackedOrder.dataUpdatedAt, trade, onCompleted, t])

  return {
    statusOrder,
    closeStatus,
    statusQueryFailed: trackedOrder.isError,
    channel,
    product,
    quote,
    qq,
    setQQ,
    open,
    calculating,
    processing: payMutation.isPending,
    selectChannel,
    selectProduct,
    confirm,
    reset,
  }
}
