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
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatInvoiceAmount } from '@/features/invoices/lib'
import { toIntlLocale } from '@/i18n/languages'
import { ROLE } from '@/lib/roles'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { getTodayTopUpAmount } from '../api'

export function TodayTopUpAmount() {
  const { t, i18n } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const isSuperAdmin = user?.role === ROLE.SUPER_ADMIN
  const { data } = useQuery({
    queryKey: ['wallet', 'topup', 'today'],
    queryFn: async () => requireServerSuccess(await getTodayTopUpAmount()).data,
    enabled: isSuperAdmin,
    staleTime: 30_000,
    refetchOnWindowFocus: 'always',
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    meta: { errorToast: false },
  })

  if (!isSuperAdmin || !data) return null

  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const amount = formatInvoiceAmount(data.amount, locale)
  const label = t("Today's total recharge")
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <output
              className='text-muted-foreground hidden h-7 max-w-48 min-w-0 shrink-0 items-center gap-1 rounded-md px-2 text-sm font-medium whitespace-nowrap tabular-nums sm:flex'
              aria-label={`${label}: ¥${amount}`}
            />
          }
        >
          <span aria-hidden='true' className='shrink-0'>
            ¥
          </span>
          <span className='min-w-0 truncate'>{amount}</span>
        </TooltipTrigger>
        <TooltipContent side='bottom'>
          <p>
            {label}: ¥{amount}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
