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
        'Join the {{name}} community group':
          'Join the {{name}} community group',
        'How do I connect this model?': 'How do I connect this model?',
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
  baocodeLink?: unknown
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['status'], {
    docs_link: options.docsLink ?? '',
    baocode_link: options.baocodeLink,
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

it.each([
  [undefined, 'https://baocode.dev/?ymengcc'],
  ['', 'https://baocode.dev/?ymengcc'],
  ['javascript:alert(1)', 'https://baocode.dev/?ymengcc'],
  ['/relative', 'https://baocode.dev/?ymengcc'],
  [42, 'https://baocode.dev/?ymengcc'],
  [
    '  https://example.com/install?ref=site#download  ',
    'https://example.com/install?ref=site#download',
  ],
])(
  'uses a safe configured destination for both BaoCode links with %s',
  async (baocodeLink, expected) => {
    await renderHero({ isAuthenticated: false, baocodeLink })

    for (const link of [
      screen.getByRole('button', { name: /Get BaoCode/ }),
      screen.getByRole('link', { name: 'BaoCode' }),
    ]) {
      expect(link).toHaveAttribute('href', expected)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link.getAttribute('rel')).toContain('noopener')
      expect(link.getAttribute('rel')).toContain('noreferrer')
    }
  }
)

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
  const community = screen
    .getByText('Join the Test Site community group')
    .closest('.landing-animate-fade-up')
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
  expect(document.querySelector('[data-community-emblem]')).toBeNull()
  expect(
    document.querySelector('.home-community-content')
  ).toBeEmptyDOMElement()
})

it('shows the example chat at every width the community card shows at', async () => {
  await renderHero({
    isAuthenticated: false,
    qqGroupLink: 'https://qm.qq.com/q/example',
    telegramLink: 'https://t.me/example',
  })

  const preview = screen
    .getByText('How do I connect this model?')
    .closest('[aria-hidden="true"].rounded-xl') as HTMLElement

  // The preview used to be hidden below 2xl, so most desktops never saw it.
  expect(preview.className).not.toMatch(/\bhidden\b|\b2xl:block\b/)
  expect(preview).toHaveClass('w-full')
})

it('wraps the brand and BaoCode as two whole blocks in the hero title', async () => {
  await renderHero({ isAuthenticated: false })

  const title = screen.getByRole('heading', { level: 1 })
  expect(title).toHaveClass('flex-wrap')
  expect(title).not.toHaveClass('whitespace-nowrap')
  const blocks = [...title.children]
  expect(blocks).toHaveLength(2)
  expect(blocks[0]).toHaveClass('min-w-0', 'max-w-full')
  expect(blocks[0].querySelector('.break-words')).toHaveTextContent('Test Site')
  expect(blocks[1]).toHaveTextContent('BaoCode')
  expect(blocks[1]).toHaveClass('shrink-0')
})

it('keeps the developer entry after the community region without an absolute gap', async () => {
  await renderHero({
    isAuthenticated: false,
    qqGroupLink: 'https://qm.qq.com/q/example',
  })

  const community = document.querySelector('.home-community-content')
  const developerEntry = screen.getByText('For developers')
  const slice = document.querySelector('.home-community-slice')
  if (!community || !slice) throw new Error('Expected community content')
  expect(community).not.toHaveClass('absolute')
  expect(community.className).toMatch(/\bempty:mb-0\b/)
  expect(slice.className).toMatch(/\bempty:mb-0\b|\bmb-10\b/)
  // The emblem layer sits behind the community text and the chat example.
  expect(slice.firstElementChild).toHaveAttribute('data-community-emblem')
  expect(slice.contains(community)).toBe(true)
  expect(
    community.compareDocumentPosition(developerEntry) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  // The split is pulled left by its padding, so the console column starts at
  // the same gutter as before and the developer entry stays clear of the seam.
  expect(document.querySelector('.home-hero-grid')).toHaveClass('lg:px-8')
  const developerColumn = developerEntry.closest('.home-hero-grid > div')
  expect(developerColumn).toHaveClass('lg:min-w-0')
})

it.each([
  ['https://qm.qq.com/q/example', '', 1],
  ['', 'https://t.me/example', 1],
  ['https://qm.qq.com/q/example', 'https://t.me/example', 2],
])(
  'reserves a single unclipped conversation slot for QQ=%s Telegram=%s',
  async (qqGroupLink, telegramLink, count) => {
    await renderHero({ isAuthenticated: false, qqGroupLink, telegramLink })

    const slot = document.querySelector('.home-chat-rounds')
    expect(slot).not.toBeNull()
    if (!slot) throw new Error('Expected a conversation slot')
    expect(slot).toHaveClass(
      'grid',
      'w-full',
      'min-w-0',
      count === 2 ? 'home-chat-rotating' : 'home-chat-static'
    )
    expect(slot.children).toHaveLength(count)
    for (const round of slot.children) {
      expect(round).toHaveClass('col-start-1', 'row-start-1')
      expect(round.querySelectorAll('.home-qq-bubble')).toHaveLength(3)
      expect(round.querySelectorAll('.home-chat-answer')).toHaveLength(1)
      for (const message of round.querySelectorAll(
        '.home-qq-bubble > span:last-child'
      )) {
        expect(message).not.toHaveClass('truncate')
      }
    }
    expect(slot.querySelectorAll('.home-qq-round-late')).toHaveLength(count - 1)
    if (qqGroupLink) {
      expect(
        within(slot as HTMLElement).getByText('How do I connect this model?')
      ).toBeInTheDocument()
      expect(
        within(slot as HTMLElement).getByText(
          'Grab a key in the console and paste it into your client'
        )
      ).toBeInTheDocument()
    }
    if (telegramLink) {
      expect(
        within(slot as HTMLElement).getByText('How do I report an error?')
      ).toBeInTheDocument()
      expect(
        within(slot as HTMLElement).getByText(
          'Post the logs in the group and we will take a look'
        )
      ).toBeInTheDocument()
    }
  }
)

it('keeps long community names wrapping above the preview and console in normal flow', async () => {
  useSystemConfigStore.setState({
    config: { ...initialSystemConfig, systemName: 'LongSiteName'.repeat(30) },
  })
  await renderHero({
    isAuthenticated: false,
    qqGroupLink: 'https://qm.qq.com/q/example',
  })

  const title = screen.getByText(/Join the LongSiteName/)
  expect(title).toHaveClass('break-words')
  expect(title).not.toHaveClass('truncate')
  const community = title.closest('.home-community-content')
  if (!community) throw new Error('Expected community content')
  expect(community).toHaveClass(
    'flex-col',
    'gap-5',
    'lg:flex-row',
    'lg:items-start',
    'empty:mb-0'
  )
  expect(community).not.toHaveClass('absolute')
  const preview = community.querySelector('[aria-hidden="true"].rounded-xl')
  expect(preview).toHaveClass('w-full', 'max-w-md', 'lg:w-60', 'lg:shrink-0')
  expect(preview).not.toHaveClass('absolute')
  // From lg up the chat example sits to the right of the join text, not below it.
  const card = title.closest('.landing-animate-fade-up')
  if (!card || !preview) throw new Error('Expected the community card')
  expect(preview.previousElementSibling).toBe(card)
  expect(
    community.compareDocumentPosition(
      screen.getByRole('heading', { level: 2 })
    ) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  // The hero title wraps its brand name instead of clipping it.
  expect(screen.getByRole('heading', { level: 1 })).toHaveClass('flex-wrap')
})

it('lets the example chat bubbles span the full card width', async () => {
  await renderHero({
    isAuthenticated: false,
    qqGroupLink: 'https://qm.qq.com/q/example',
    telegramLink: 'https://t.me/example',
  })

  const rounds = [...document.querySelectorAll('.home-qq-round')]
  expect(rounds.length).toBeGreaterThan(0)
  for (const round of rounds) {
    expect(round).toHaveClass('w-full')
    for (const bubble of round.querySelectorAll('.home-qq-bubble')) {
      expect(bubble).toHaveClass('w-full')
    }
  }
})

it.each([
  ['https://qm.qq.com/q/example', '', 1],
  ['', 'https://t.me/example', 1],
  ['https://qm.qq.com/q/example', 'https://t.me/example', 2],
])(
  'shows a background emblem for each configured group with QQ=%s Telegram=%s',
  async (qqGroupLink, telegramLink, count) => {
    await renderHero({ isAuthenticated: false, qqGroupLink, telegramLink })

    const emblem = document.querySelector('[data-community-emblem]')
    expect(emblem).not.toBeNull()
    if (!emblem) throw new Error('Expected a background emblem')
    expect(emblem.querySelectorAll('svg')).toHaveLength(count)
  }
)

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
