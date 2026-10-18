/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { formatLocalCurrencyAmount } from '@/lib/currency'

import { isValidCatfkQQ, isValidCatfkQuote } from '../../catfk-api'
import { DEFAULT_DISCOUNT_RATE } from '../../constants'
import { formatCurrency, formatCreemPrice, getPaymentIcon } from '../../lib'
import type { PaymentMethod, CatfkQuote } from '../../types'

interface PaymentConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  topupAmount: number
  paymentAmount: number
  paymentMethod: PaymentMethod | undefined
  calculating: boolean
  processing: boolean
  discountRate?: number
  usdExchangeRate?: number
  catfk?: {
    quote: CatfkQuote | null
    qq: string
    onQQChange: (value: string) => void
    available: boolean
    qqLocked?: boolean
  }
}

export function PaymentConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  topupAmount,
  paymentAmount,
  paymentMethod,
  calculating,
  processing,
  discountRate = DEFAULT_DISCOUNT_RATE,
  usdExchangeRate = 1,
  catfk,
}: PaymentConfirmDialogProps) {
  const { t } = useTranslation()
  const hasDiscount =
    !catfk && discountRate > 0 && discountRate < 1 && paymentAmount > 0
  const originalAmount = hasDiscount ? paymentAmount / discountRate : 0
  const discountAmount = hasDiscount ? originalAmount - paymentAmount : 0

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!processing) onOpenChange(next)
      }}
      title={t('Confirm Payment')}
      desc={t('Review your payment details')}
      handleConfirm={onConfirm}
      isLoading={processing}
      disabled={
        calculating ||
        !Number.isFinite(paymentAmount) ||
        paymentAmount <= 0 ||
        !!(
          catfk &&
          (!catfk.available ||
            !isValidCatfkQQ(catfk.qq) ||
            !isValidCatfkQuote(catfk.quote, topupAmount))
        )
      }
      confirmText={
        <>
          {processing && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
          {t('Confirm Payment')}
        </>
      }
      className='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-md'
    >
      <div className='space-y-3 py-3 sm:space-y-4 sm:py-4'>
        <div className='flex items-center justify-between'>
          <span className='text-muted-foreground text-sm'>
            {t('Topup Amount')}
          </span>
          <span className='text-lg font-semibold'>
            {catfk
              ? formatCreemPrice(topupAmount, 'USD')
              : formatLocalCurrencyAmount(topupAmount * usdExchangeRate, {
                  digitsLarge: 2,
                  digitsSmall: 2,
                  abbreviate: false,
                })}
          </span>
        </div>

        <div className='flex items-center justify-between'>
          <span className='text-muted-foreground text-sm'>{t('You Pay')}</span>
          {calculating ? (
            <Skeleton className='h-6 w-24' />
          ) : (
            <div className='flex items-baseline gap-2'>
              <span className='text-2xl font-semibold'>
                {formatCurrency(paymentAmount)} {catfk?.quote?.currency}
              </span>
              {hasDiscount && (
                <span className='text-muted-foreground text-sm line-through'>
                  {formatCurrency(originalAmount)}
                </span>
              )}
            </div>
          )}
        </div>

        {hasDiscount && !calculating && (
          <div className='bg-muted/50 rounded-lg p-3'>
            <div className='flex items-center justify-between text-sm'>
              <span className='text-muted-foreground'>{t('You save')}</span>
              <span className='font-semibold text-green-600'>
                {formatCurrency(discountAmount)}
              </span>
            </div>
          </div>
        )}

        <div className='border-t pt-4'>
          <div className='flex items-center justify-between'>
            <span className='text-muted-foreground text-sm'>
              {t('Payment Method')}
            </span>
            <div className='flex items-center gap-2'>
              {getPaymentIcon(
                paymentMethod?.type,
                'h-4 w-4',
                paymentMethod?.icon,
                paymentMethod?.name
              )}
              <span className='font-medium'>{paymentMethod?.name}</span>
            </div>
          </div>
        </div>
      </div>

      {catfk && (
        <div className='space-y-2'>
          <Label htmlFor='catfk-qq'>{t('QQ number')}</Label>
          <Input
            id='catfk-qq'
            inputMode='numeric'
            autoComplete='off'
            required
            value={catfk.qq}
            disabled={processing || catfk.qqLocked}
            onChange={(event) => catfk.onQQChange(event.target.value)}
            aria-invalid={catfk.qq.length > 0 && !isValidCatfkQQ(catfk.qq)}
            aria-describedby='catfk-qq-hint'
          />
          <p id='catfk-qq-hint' className='text-muted-foreground text-xs'>
            {t(
              'Enter ASCII digits only. QQ is used for this payment, not as your account identity.'
            )}
          </p>
        </div>
      )}
    </ConfirmDialog>
  )
}
