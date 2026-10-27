import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/config'
import { toIntlLocale } from '@/i18n/languages'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { TodayTopUpAmount } from '../components/today-topup-amount'

const clients: QueryClient[] = []

function renderAmount(role = 100) {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'viewer', role })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <TodayTopUpAmount />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
})

afterEach(async () => {
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
  vi.useRealTimers()
  localStorage.clear()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  await i18n.changeLanguage('en')
})

describe('TodayTopUpAmount', () => {
  it('shows the credited amount without exchange-rate conversion for root', async () => {
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType: 'USD',
        usdExchangeRate: 7,
      },
    })
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: { amount: 1_234_567_890_000 } },
    })

    renderAmount()

    expect(
      await screen.findByRole('status', {
        name: "Today's total recharge: ¥1,234,567.89",
      })
    ).toBeInTheDocument()
  })

  it.each([10, 1])(
    'does not display or request the total for role %i',
    async (role) => {
      const get = vi.spyOn(api, 'get')
      renderAmount(role)

      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      await act(() => Promise.resolve())
      expect(get).not.toHaveBeenCalled()
    }
  )

  it('shows a true zero total but no fabricated zero while loading', () => {
    vi.spyOn(api, 'get').mockReturnValue(new Promise(() => undefined))
    renderAmount()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows a zero response and hides the entry after a request failure', async () => {
    const get = vi.spyOn(api, 'get')
    get.mockResolvedValueOnce({
      data: { success: true, data: { amount: 0 } },
    })
    const { unmount } = renderAmount()
    expect(
      await screen.findByRole('status', {
        name: "Today's total recharge: ¥0.00",
      })
    ).toBeInTheDocument()
    unmount()
    clients.splice(0).forEach((client) => client.clear())

    get.mockRejectedValueOnce(new Error('offline'))
    renderAmount()
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it.each(['zhCN', 'zhTW', 'fr', 'ru', 'ja', 'vi', 'en', 'invalid'])(
    'formats with a valid Intl locale for interface language %s',
    async (language) => {
      await act(() => i18n.changeLanguage(language))
      vi.spyOn(api, 'get').mockResolvedValue({
        data: { success: true, data: { amount: 12_340_000 } },
      })
      renderAmount()
      const formatted = new Intl.NumberFormat(toIntlLocale(language), {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      }).format(12.34)
      expect(
        await screen.findByRole('status', {
          name: `Today's total recharge: ¥${formatted}`,
        })
      ).toBeInTheDocument()
    }
  )

  it('updates the number locale when the interface language changes', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: { amount: 1_234_500_000 } },
    })
    renderAmount()
    await screen.findByRole('status', {
      name: "Today's total recharge: ¥1,234.50",
    })
    await act(() => i18n.changeLanguage('fr'))
    expect(
      screen.getByRole('status', {
        name: "Today's total recharge: ¥1 234,50",
      })
    ).toBeInTheDocument()
  })

  it('refreshes the amount after crossing local midnight', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 26, 23, 59, 30))
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce({
        data: { success: true, data: { amount: 1_000_000 } },
      })
      .mockResolvedValueOnce({
        data: { success: true, data: { amount: 2_000_000 } },
      })
    renderAmount()
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          screen.getByRole('status', {
            name: "Today's total recharge: ¥1.00",
          })
        ).toBeInTheDocument()
      )
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
      await vi.waitFor(() =>
        expect(
          screen.getByRole('status', {
            name: "Today's total recharge: ¥2.00",
          })
        ).toBeInTheDocument()
      )
    })
    expect(get).toHaveBeenCalledTimes(2)
  })
})
