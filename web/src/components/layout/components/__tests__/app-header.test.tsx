import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { SidebarProvider } from '@/components/ui/sidebar'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { AppHeader } from '../app-header'

vi.mock('@/components/config-drawer', () => ({
  ConfigDrawer: () => null,
}))
vi.mock('@/components/language-switcher', () => ({
  LanguageSwitcher: () => null,
}))
vi.mock('@/components/notification-popover', () => ({
  NotificationPopover: () => null,
}))
vi.mock('@/components/profile-dropdown', () => ({
  ProfileDropdown: () => <button type='button'>Profile</button>,
}))
vi.mock('@/components/search', () => ({
  Search: () => null,
}))
vi.mock('@/components/layout/components/system-brand', () => ({
  SystemBrand: () => null,
}))
vi.mock('@/features/system-update/system-update-action', () => ({
  SystemUpdateAction: () => null,
}))
vi.mock('@/hooks/use-notifications', () => ({
  useNotifications: () => ({}),
}))
vi.mock('@/hooks/use-top-nav-links', () => ({
  useTopNavLinks: () => [],
}))

const clients: QueryClient[] = []

async function renderHeader(showProfileDropdown: boolean) {
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'root',
    role: 100,
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { amount: 1_000_000 } },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  const root = createRootRoute()
  const index = createRoute({ getParentRoute: () => root, path: '/' })
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <SidebarProvider>
        <RouterProvider router={router} />
        <AppHeader
          showTopNav={false}
          showSearch={false}
          showNotifications={false}
          showConfigDrawer={false}
          showProfileDropdown={showProfileDropdown}
        />
      </SidebarProvider>
    </QueryClientProvider>
  )
}

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
})

it('places the daily recharge immediately before the profile entry', async () => {
  await renderHeader(true)

  const amount = await screen.findByRole('status', {
    name: "Today's total recharge: ¥1.00",
  })
  expect(amount.nextElementSibling).toBe(screen.getByText('Profile'))
})

it('hides the recharge alongside a hidden profile entry', async () => {
  await renderHeader(false)

  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.queryByText('Profile')).not.toBeInTheDocument()
})
