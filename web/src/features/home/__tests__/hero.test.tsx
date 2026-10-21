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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it } from 'vitest'

import { Hero } from '../components/sections/hero'

const i18n = createInstance()
await i18n.init({
  lng: 'en',
  resources: { en: { translation: {} } },
  initAsync: false,
})

async function renderHero(options: {
  isAuthenticated: boolean
  docsLink?: string
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['status'], { docs_link: options.docsLink ?? '' })
  const root = createRootRoute({
    component: () => <Hero isAuthenticated={options.isAuthenticated} />,
  })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  )
  await screen.findByRole('heading', { level: 1 })
}

afterEach(() => {
  cleanup()
})

it('links the BaoCode entry to the YMeng CC channel page in a new tab', async () => {
  await renderHero({ isAuthenticated: false })

  const link = screen.getByRole('button', { name: /Get BaoCode/ })

  expect(link).toHaveAttribute('href', 'https://baocode.dev/?ymengcc')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link.getAttribute('rel')).toContain('noopener')
})

it('links the QQ group entry to the community invite in a new tab', async () => {
  await renderHero({ isAuthenticated: false })

  const link = screen.getByRole('button', { name: /Join group/ })

  expect(link).toHaveAttribute('href', 'https://qm.qq.com/q/gLTLDuSMms')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link.getAttribute('rel')).toContain('noopener')
})

it('keeps the example chat in the community slice out of the accessibility tree', async () => {
  await renderHero({ isAuthenticated: false })

  const example = screen.queryByText('Already live, try it in the console')

  expect(example).not.toBeNull()
  expect(example?.closest('[aria-hidden="true"]')).not.toBeNull()
})

it('shows sign-up and pricing entries to signed-out visitors', async () => {
  await renderHero({ isAuthenticated: false })

  expect(screen.getByRole('button', { name: /Get Started/ })).toHaveAttribute(
    'href',
    '/sign-up'
  )
  expect(screen.getByRole('button', { name: 'View Pricing' })).toHaveAttribute(
    'href',
    '/pricing'
  )
  expect(screen.queryByRole('button', { name: /Go to Dashboard/ })).toBeNull()
})

it('shows the dashboard entry instead of sign-up to signed-in users', async () => {
  await renderHero({ isAuthenticated: true })

  expect(
    screen.getByRole('button', { name: /Go to Dashboard/ })
  ).toHaveAttribute('href', '/dashboard')
  expect(screen.queryByRole('button', { name: /Get Started/ })).toBeNull()
})

it('opens an external docs link in a new tab', async () => {
  await renderHero({
    isAuthenticated: false,
    docsLink: 'https://docs.example.com',
  })

  const docs = screen.getByRole('button', { name: 'Docs' })

  expect(docs).toHaveAttribute('href', 'https://docs.example.com')
  expect(docs).toHaveAttribute('target', '_blank')
})

it('keeps a relative docs link inside the app', async () => {
  await renderHero({ isAuthenticated: false, docsLink: '/about' })

  const docs = screen.getByRole('button', { name: 'Docs' })

  expect(docs).toHaveAttribute('href', '/about')
  expect(docs).not.toHaveAttribute('target')
})

it('exposes one page heading and hides the decorative seam badges', async () => {
  await renderHero({ isAuthenticated: false })

  const pageHeadings = screen.getAllByRole('heading', { level: 1 })
  expect(pageHeadings).toHaveLength(1)
  expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument()
  const badges = screen
    .getAllByText('×')
    .filter((element) => !pageHeadings[0].contains(element))
  expect(badges.length).toBeGreaterThan(0)
  for (const badge of badges) {
    expect(badge).toHaveAttribute('aria-hidden', 'true')
  }
})
