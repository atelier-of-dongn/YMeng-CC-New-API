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
import { cleanup, render, screen, within } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { useSystemConfigStore } from '@/stores/system-config-store'

import { Hero } from '../components/sections/hero'

// Keys are interpolated with `{{name}}`, so the instance needs matching
// resources instead of falling back to the key itself.
const i18n = createInstance()
await i18n.init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        'Join the {{name}} community group': 'Join the {{name}} community group',
        'How do I connect this model?': 'How do I connect this model?',
        'What is the model for?': 'What is the model for?',
        'How do I report an error?': 'How do I report an error?',
        'Grab a key in the console and paste it into your client':
          'Grab a key in the console and paste it into your client',
        'Post the logs in the group and we will take a look':
          'Post the logs in the group and we will take a look',
      },
    },
  },
  initAsync: false,
})

// The community card is the element that holds the join buttons; the example
// chat repeats the platform names, so platform assertions stay inside it.
function getCommunityCard(): HTMLElement | null {
  return (
    screen
      .queryByRole('button', { name: /Join QQ group/ })
      ?.closest('.landing-animate-fade-up') ?? null
  )
}

const initialSystemConfig = useSystemConfigStore.getState().config

beforeEach(() => {
  useSystemConfigStore.setState({
    config: { ...initialSystemConfig, systemName: 'Test Site' },
  })
})

afterEach(() => {
  useSystemConfigStore.setState({ config: initialSystemConfig })
})

async function renderHero(options: {
  isAuthenticated: boolean
  docsLink?: string
  qqGroupLink?: string
  telegramLink?: string
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['status'], {
    docs_link: options.docsLink ?? '',
    community_qq_group_link: options.qqGroupLink ?? '',
    community_telegram_link: options.telegramLink ?? '',
  })
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

it('links the QQ group entry to the configured link in a new tab', async () => {
  await renderHero({
    isAuthenticated: false,
    qqGroupLink: 'https://qm.qq.com/q/example',
  })

  const link = screen.getByRole('button', { name: /Join QQ group/ })

  expect(link).toHaveAttribute('href', 'https://qm.qq.com/q/example')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link.getAttribute('rel')).toContain('noopener')
  expect(
    screen.queryByRole('button', { name: /Join Telegram group/ })
  ).toBeNull()
})

it('links the Telegram group entry to the configured link in a new tab', async () => {
  await renderHero({
    isAuthenticated: false,
    telegramLink: 'https://t.me/example',
  })

  const link = screen.getByRole('button', { name: /Join Telegram group/ })

  expect(link).toHaveAttribute('href', 'https://t.me/example')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link.getAttribute('rel')).toContain('noopener')
  expect(screen.queryByRole('button', { name: /Join QQ group/ })).toBeNull()
  expect(getCommunityCard()).toBeNull()
})

it('shows both group entries and both platform logos when both links are configured', async () => {
  await renderHero({
    isAuthenticated: false,
    qqGroupLink: 'https://qm.qq.com/q/example',
    telegramLink: 'https://t.me/example',
  })

  expect(screen.getByRole('button', { name: /Join QQ group/ })).toHaveAttribute(
    'href',
    'https://qm.qq.com/q/example'
  )
  expect(
    screen.getByRole('button', { name: /Join Telegram group/ })
  ).toHaveAttribute('href', 'https://t.me/example')
  const community = getCommunityCard()
  expect(community).not.toBeNull()
  expect(
    within(community as HTMLElement).getByText('QQ', { exact: true })
  ).toBeInTheDocument()
  expect(
    within(community as HTMLElement).getByText('Telegram', { exact: true })
  ).toBeInTheDocument()
})

it('titles the community card with the configured system name', async () => {
  await renderHero({
    isAuthenticated: false,
    qqGroupLink: 'https://qm.qq.com/q/example',
  })

  expect(
    screen.getByText('Join the Test Site community group')
  ).toBeInTheDocument()
  expect(screen.queryByText(/YMeng CC/)).toBeNull()
})

it('hides the community card and the example chat when no group links are configured', async () => {
  await renderHero({ isAuthenticated: false })

  expect(screen.queryByText('Q&A, feedback and new model updates')).toBeNull()
  expect(screen.queryByRole('button', { name: /Join QQ group/ })).toBeNull()
  expect(
    screen.queryByRole('button', { name: /Join Telegram group/ })
  ).toBeNull()
  expect(screen.queryByText('How do I connect this model?')).toBeNull()
})

it('shows the question and the answer of each configured group in the example chat', async () => {
  await renderHero({
    isAuthenticated: false,
    qqGroupLink: 'https://qm.qq.com/q/example',
    telegramLink: 'https://t.me/example',
  })

  // Both lines must be rendered: a fixed-height, end-aligned container used to
  // clip the question above it and leave only the answer visible.
  expect(screen.getByText('How do I connect this model?')).toBeVisible()
  expect(screen.getByText('How do I report an error?')).toBeVisible()
  expect(
    screen.getByText('Grab a key in the console and paste it into your client')
  ).toBeVisible()
})

it('keeps the example chat in the community slice out of the accessibility tree', async () => {
  await renderHero({
    isAuthenticated: false,
    qqGroupLink: 'https://qm.qq.com/q/example',
  })

  const example = screen.getByText('How do I connect this model?')

  expect(example.closest('[aria-hidden="true"]')).not.toBeNull()
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
  expect(screen.queryByRole('button', { name: /Sign in/ })).toBeNull()
})

it('shows the sign-in entry to the dashboard instead of sign-up to signed-in users', async () => {
  await renderHero({ isAuthenticated: true })

  expect(screen.getByRole('button', { name: /Sign in/ })).toHaveAttribute(
    'href',
    '/dashboard'
  )
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

it('stacks the developer entry above the BaoCode entry below lg', async () => {
  await renderHero({ isAuthenticated: false })

  const developerEntry = screen.getByText('For developers')
  const baocodeEntry = screen.getByRole('button', { name: /Get BaoCode/ })
  expect(
    developerEntry.compareDocumentPosition(baocodeEntry) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()

  const developerColumn = developerEntry.closest('.grid > div')
  const baocodeColumn = baocodeEntry.closest('.grid > div')
  expect(developerColumn).toHaveClass('lg:col-start-2')
  expect(baocodeColumn).toHaveClass('lg:col-start-1')
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
