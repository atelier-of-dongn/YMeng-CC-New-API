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
import { ExternalLink, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import {
  formatBillingCurrencyFromUSD,
  formatLocalCurrencyAmount,
} from '@/lib/currency'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { isValidCatfkQQ, isValidCatfkQuote } from '../../catfk-api'
import { DEFAULT_DISCOUNT_RATE } from '../../constants'
import {
  formatCurrency,
  getPaymentIcon,
  getTopupPromptContent,
  getTopupPromptVisibility,
} from '../../lib'
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
  }
  topupLink?: string
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
  topupLink,
}: PaymentConfirmDialogProps) {
  const { t, i18n } = useTranslation()
  useSystemConfigStore((state) => state.config.currency)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const invalidQQ = !!catfk && catfk.qq.length > 0 && !isValidCatfkQQ(catfk.qq)
  const hasDiscount =
    !catfk && discountRate > 0 && discountRate < 1 && paymentAmount > 0
  const originalAmount = hasDiscount ? paymentAmount / discountRate : 0
  const discountAmount = hasDiscount ? originalAmount - paymentAmount : 0
  const topupPromptVisibility = getTopupPromptVisibility(
    paymentMethod,
    topupLink
  )
  const topupPromptContent = getTopupPromptContent(paymentMethod)
  const showTopupPrompt =
    (topupPromptVisibility.showNotice && !!topupPromptContent.noticeText) ||
    (topupPromptVisibility.showLink && !!topupPromptContent.linkImage)
  const noticeText = topupPromptContent.noticeText

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
              ? formatBillingCurrencyFromUSD(topupAmount, {
                  digitsLarge: 2,
                  digitsSmall: 2,
                  abbreviate: false,
                  locale,
                })
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
                {formatCurrency(paymentAmount)}
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
          <div className='flex items-center gap-3'>
            <Label htmlFor='catfk-qq' className='shrink-0'>
              <span className='text-destructive' aria-hidden='true'>
                *
              </span>
              {t('Contact method')}
            </Label>
            <Input
              id='catfk-qq'
              className='bg-muted/50 h-11 flex-1'
              inputMode='numeric'
              autoComplete='off'
              required
              minLength={5}
              maxLength={12}
              placeholder={t('Enter QQ number (5-12 digits)')}
              value={catfk.qq}
              disabled={processing}
              onChange={(event) => catfk.onQQChange(event.target.value)}
              aria-invalid={invalidQQ}
              aria-describedby={invalidQQ ? 'catfk-qq-hint' : undefined}
            />
          </div>
          {invalidQQ && (
            <p id='catfk-qq-hint' className='text-destructive text-xs'>
              {t('Enter QQ number (5-12 digits)')}
            </p>
          )}
        </div>
      )}
      {showTopupPrompt && (
        <div className='bg-muted/50 flex flex-col items-center gap-3 rounded-lg p-4 text-center'>
          {topupPromptVisibility.showNotice && noticeText && (
            <p className='text-muted-foreground text-sm leading-relaxed'>
              {noticeText}
            </p>
          )}
          {topupPromptVisibility.showLink &&
            topupLink &&
            topupPromptContent.linkImage && (
              <a
                href={topupLink}
                target='_blank'
                rel='noopener noreferrer'
                aria-label={t('Open external top-up link')}
                title={t('Open external top-up link')}
                className='focus-visible:ring-ring group relative inline-flex rounded-lg transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none'
              >
                <img
                  src={topupPromptContent.linkImage}
                  alt={t('Open external top-up link')}
                  className='h-12 w-auto rounded-lg'
                />
                <span className='bg-background text-muted-foreground group-hover:text-foreground absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border shadow-sm'>
                  <ExternalLink className='h-3 w-3' aria-hidden='true' />
                </span>
              </a>
            )}
        </div>
      )}
    </ConfirmDialog>
  )
}
