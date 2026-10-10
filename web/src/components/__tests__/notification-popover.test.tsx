import { render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { NotificationPopover } from '@/components/notification-popover'

const originalGetAnimations = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'getAnimations'
)
beforeAll(() => {
  // jsdom does not implement the Web Animations API used by ScrollArea.
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
})
afterAll(() => {
  if (originalGetAnimations) {
    Object.defineProperty(
      HTMLElement.prototype,
      'getAnimations',
      originalGetAnimations
    )
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
  }
})

function renderNotice(notice: string) {
  return (
    <NotificationPopover
      open
      onOpenChange={() => undefined}
      unreadCount={0}
      activeTab='notice'
      onTabChange={() => undefined}
      notice={notice}
      announcements={[]}
      loading={false}
    />
  )
}

async function getNoticeShadowRoot(): Promise<ShadowRoot> {
  let root: ShadowRoot | null = null
  await waitFor(() => {
    const panel = screen.getByRole('tabpanel', { name: 'Notice' })
    root =
      [...panel.querySelectorAll('div')]
        .map((element) => element.shadowRoot)
        .find((shadow) => shadow !== null) ?? null
    expect(root).not.toBeNull()
  })
  if (!root) throw new Error('HTML notice was not rendered')
  return root
}

describe('system notice rendering', () => {
  it('renders indented HTML with scoped styles and links', async () => {
    render(
      renderNotice(`
      <style>.notice-title { color: red; }</style>
      <h2 class="notice-title">Maintenance</h2>
      <a href="https://example.com/status" target="_blank">Status</a>
      <img src="https://example.com/banner.png" alt="Maintenance banner">
    `)
    )

    const root = await getNoticeShadowRoot()
    const content = within(root as unknown as HTMLElement)
    expect(content.getByRole('heading', { name: 'Maintenance' })).toBeVisible()
    expect(
      content.getByRole('img', { name: 'Maintenance banner' })
    ).toBeVisible()
    expect(content.getByRole('link', { name: 'Status' })).toHaveAttribute(
      'rel',
      'noopener noreferrer'
    )
    expect(root.textContent).toContain('.notice-title { color: red; }')
    expect(document.body.textContent).not.toContain(
      '.notice-title { color: red; }'
    )
  })

  it('renders HTML document body and updates the displayed notice', async () => {
    const view = render(
      renderNotice(
        '<!doctype html><html><body><h2>First notice</h2></body></html>'
      )
    )
    const root = await getNoticeShadowRoot()
    expect(
      within(root as unknown as HTMLElement).getByRole('heading', {
        name: 'First notice',
      })
    ).toBeVisible()

    view.rerender(renderNotice('<section><h2>Updated notice</h2></section>'))
    await waitFor(() => {
      expect(
        within(root as unknown as HTMLElement).getByRole('heading', {
          name: 'Updated notice',
        })
      ).toBeVisible()
    })
    expect(root.textContent).not.toContain('First notice')
  })

  it.each([
    [
      'Markdown headings',
      '# Maintenance\n\n**Scheduled outage**',
      'Scheduled outage',
    ],
    [
      'embedded HTML',
      '# Maintenance\n\nA <strong>scheduled outage</strong>.',
      'scheduled outage',
    ],
    ['HTML code blocks', '```html\n<h2>Example</h2>\n```', '<h2>Example</h2>'],
  ])('preserves %s in Markdown notices', async (_label, notice, text) => {
    render(renderNotice(notice))
    expect(await screen.findByText(text)).toBeVisible()
    if (notice.startsWith('#')) {
      expect(screen.getByRole('heading', { name: 'Maintenance' })).toBeVisible()
    } else {
      expect(
        screen.queryByRole('heading', { name: 'Example' })
      ).not.toBeInTheDocument()
    }
  })

  it('removes scripts, event handlers and unsafe URLs from HTML notices', async () => {
    render(
      renderNotice(`<section>
      <h2>Safe notice</h2>
      <script>window.noticeAttack = true</script>
      <img src="invalid.png" alt="Banner" onerror="alert(1)">
      <a href="javascript:alert(1)" onclick="alert(1)">Unsafe link</a>
    </section>`)
    )
    const root = await getNoticeShadowRoot()
    const content = within(root as unknown as HTMLElement)
    expect(content.getByRole('heading', { name: 'Safe notice' })).toBeVisible()
    expect(root.querySelector('script')).toBeNull()
    expect(content.getByRole('img', { name: 'Banner' })).not.toHaveAttribute(
      'onerror'
    )
    const link = content.getByText('Unsafe link')
    expect(link).not.toHaveAttribute('href')
    expect(link).not.toHaveAttribute('onclick')
  })
})
