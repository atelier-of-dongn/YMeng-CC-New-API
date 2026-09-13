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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'
import {
  getCustomHeaderNavId,
  HEADER_NAV_MAX_ENABLED,
  isSafeHeaderNavHref,
  parseHeaderNavModulesFromStatus,
  type HeaderNavBuiltinKey,
} from '@/lib/nav-modules'
import { useAuthStore } from '@/stores/auth-store'

export type TopNavLink = {
  title: string
  href: string
  disabled?: boolean
  requiresAuth?: boolean
  external?: boolean
}

export function useTopNavLinks(): TopNavLink[] {
  const { t } = useTranslation()
  const { status } = useStatus()
  const { auth } = useAuthStore()

  const modules = useMemo(
    () =>
      parseHeaderNavModulesFromStatus(status as Record<string, unknown> | null),
    [status]
  )

  const docsLink = status?.docs_link as string | undefined
  const isAuthed = !!auth?.user
  const builtinLinks: Record<HeaderNavBuiltinKey, TopNavLink | null> = {
    home: modules.home ? { title: t('Home'), href: '/' } : null,
    console: modules.console
      ? { title: t('Console'), href: '/dashboard' }
      : null,
    pricing: modules.pricing.enabled
      ? {
          title: t('Model Square'),
          href: '/pricing',
          requiresAuth: modules.pricing.requireAuth && !isAuthed,
        }
      : null,
    rankings: modules.rankings.enabled
      ? {
          title: t('Rankings'),
          href: '/rankings',
          requiresAuth: modules.rankings.requireAuth && !isAuthed,
        }
      : null,
    docs: modules.docs
      ? {
          title: t('Docs'),
          href: docsLink || '/docs',
          external: Boolean(docsLink),
        }
      : null,
    about: modules.about ? { title: t('About'), href: '/about' } : null,
  }
  const customLinks = new Map(
    modules.customLinks.map((link) => [link.id, link] as const)
  )

  return modules.order
    .flatMap<TopNavLink>((reference) => {
      if (reference in builtinLinks) {
        const link = builtinLinks[reference as HeaderNavBuiltinKey]
        return link ? [link] : []
      }

      const customId = getCustomHeaderNavId(reference)
      const customLink = customId ? customLinks.get(customId) : undefined
      if (
        !customLink?.enabled ||
        !customLink.name ||
        !isSafeHeaderNavHref(customLink.url)
      ) {
        return []
      }

      return [
        {
          title: customLink.name,
          href: customLink.url,
          external: !customLink.url.startsWith('/'),
        },
      ]
    })
    .slice(0, HEADER_NAV_MAX_ENABLED)
}
