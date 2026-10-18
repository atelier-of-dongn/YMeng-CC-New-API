import { useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { handleServerError } from '@/lib/handle-server-error'

import {
  CatfkPaymentRejectedError,
  getCatfkOrder,
  isValidCatfkQQ,
  isValidCatfkQuote,
  payCatfk,
  quoteCatfk,
  safeCatfkPaymentUrl,
} from '../catfk-api'
import type {
  CatfkChannel,
  CatfkInfo,
  CatfkProduct,
  CatfkQuote,
} from '../types'

const unknownOrderMarker = 'creation_unknown'

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
  const [pendingTrade, setPendingTrade] = useState<string | null>(null)
  const [orderStatus, setOrderStatus] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const generation = useRef(0)
  const identity = useRef(userId)
  identity.current = userId
  const inFlight = useRef(false)
  const attempt = useRef<{ qq: string; key: string } | null>(null)
  const unresolved = useRef(false)
  const storageKey = userId ? `wallet:catfk:order:${userId}` : null
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
  const orderMutation = useMutation({
    mutationFn: getCatfkOrder,
    meta: { errorToast: false },
    retry: false,
  })

  const invalidateGeneration = useCallback(() => {
    generation.current++
  }, [])

  useEffect(() => {
    generation.current++
    inFlight.current = false
    attempt.current = null
    setChannel(null)
    setProduct(null)
    setQuote(null)
    setQQ('')
    setOpen(false)
    setCalculating(false)
    let stored: string | null = null
    try {
      stored = storageKey ? localStorage.getItem(storageKey) : null
    } catch {
      /* Storage may be unavailable. */
    }
    const unknown = stored === unknownOrderMarker
    unresolved.current = unknown
    setUncertain(unknown)
    setPendingTrade(unknown ? null : stored)
    setOrderStatus(unknown ? 'creation_unknown' : null)
    return invalidateGeneration
  }, [storageKey, invalidateGeneration])

  function reset() {
    if (inFlight.current) return
    generation.current++
    setOpen(false)
    setQQ('')
    setQuote(null)
    setCalculating(false)
    if (!unresolved.current) attempt.current = null
  }

  function selectChannel(next: CatfkChannel | null) {
    if (inFlight.current) return
    reset()
    setChannel(next)
    setProduct(null)
  }

  async function selectProduct(next: CatfkProduct) {
    if (inFlight.current || unresolved.current) return
    reset()
    setProduct(next)
    if (!userId || !channel || !info?.enabled || !info.available) return
    const version = generation.current
    setOpen(true)
    setCalculating(true)
    try {
      const result = await quoteMutation.mutateAsync({
        product_id: next.id,
        channel_id: channel.id,
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
      (unresolved.current && !attempt.current) ||
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
    if (attempt.current && attempt.current.qq !== qq) return
    const version = generation.current
    if (!attempt.current) attempt.current = { qq, key: crypto.randomUUID() }
    inFlight.current = true
    unresolved.current = true
    setUncertain(true)
    setOrderStatus('submitting')
    // Persist no QQ, quote, payment URL, or reusable request data. A lost response must not create another order.
    try {
      if (storageKey) localStorage.setItem(storageKey, unknownOrderMarker)
    } catch {
      /* Retain the guard in memory. */
    }
    try {
      const order = await payMutation.mutateAsync({
        product_id: product.id,
        channel_id: channel.id,
        quote_id: quote.quote_id,
        qq,
        idempotency_key: attempt.current.key,
      })
      if (version !== generation.current || identity.current !== userId) return
      if (
        typeof order.trade_no !== 'string' ||
        !order.trade_no ||
        typeof order.status !== 'string'
      ) {
        throw new Error(t('Invalid payment response'))
      }
      setPendingTrade(order.trade_no)
      setOrderStatus(order.status)
      setUncertain(false)
      unresolved.current = false
      try {
        if (storageKey) localStorage.setItem(storageKey, order.trade_no)
      } catch {
        /* Recovery still works in this session. */
      }
      const url = safeCatfkPaymentUrl(order.payment_url)
      if (order.status === 'pending' && url) window.location.assign(url)
      else setOpen(false)
    } catch (error) {
      if (version === generation.current && identity.current === userId) {
        if (error instanceof CatfkPaymentRejectedError) {
          unresolved.current = false
          attempt.current = null
          setUncertain(false)
          setOrderStatus(null)
          try {
            if (storageKey) {
              if (pendingTrade) localStorage.setItem(storageKey, pendingTrade)
              else localStorage.removeItem(storageKey)
            }
          } catch {
            /* The in-memory guard is already cleared. */
          }
        } else setOrderStatus('creation_unknown')
        handleServerError(error, t('Payment request failed'))
      }
    } finally {
      if (version === generation.current && identity.current === userId) {
        inFlight.current = false
      }
    }
  }

  async function resume() {
    if (!pendingTrade || orderMutation.isPending) return
    const version = generation.current
    try {
      const order = await orderMutation.mutateAsync(pendingTrade)
      if (version !== generation.current || identity.current !== userId) return
      if (order.trade_no !== pendingTrade || typeof order.status !== 'string') {
        throw new Error(t('Invalid payment response'))
      }
      setOrderStatus(order.status)
      if (order.status === 'completed' || order.status === 'expired') {
        unresolved.current = false
        attempt.current = null
        setPendingTrade(null)
        setUncertain(false)
        try {
          if (storageKey) localStorage.removeItem(storageKey)
        } catch {
          /* Storage may be unavailable. */
        }
        if (order.status === 'completed') await onCompleted?.()
        return
      }
      const url = safeCatfkPaymentUrl(order.payment_url)
      if (order.status === 'pending' && url) window.location.assign(url)
    } catch (error) {
      if (version === generation.current && identity.current === userId) {
        handleServerError(error, t('Payment request failed'))
      }
    }
  }

  return {
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
    pendingTrade,
    resume,
    resuming: orderMutation.isPending,
    uncertain,
    blocked: uncertain,
    orderStatus,
  }
}
