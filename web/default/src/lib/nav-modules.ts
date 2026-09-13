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
import { getStatus } from '@/lib/api'

export type ModuleAccess = { enabled: boolean; requireAuth: boolean }

export const HEADER_NAV_BUILTIN_KEYS = [
  'home',
  'console',
  'pricing',
  'rankings',
  'docs',
  'about',
] as const

export const HEADER_NAV_MAX_ENABLED = 10
export const HEADER_NAV_MAX_CUSTOM_LINKS = 10
export const HEADER_NAV_DESKTOP_VISIBLE = 6
export const HEADER_NAV_CUSTOM_PREFIX = 'custom:'

export function splitHeaderNavLinks<T>(links: T[]): {
  visible: T[]
  overflow: T[]
} {
  return {
    visible: links.slice(0, HEADER_NAV_DESKTOP_VISIBLE),
    overflow: links.slice(HEADER_NAV_DESKTOP_VISIBLE),
  }
}

export type HeaderNavBuiltinKey = (typeof HEADER_NAV_BUILTIN_KEYS)[number]

export type HeaderNavCustomLink = {
  id: string
  enabled: boolean
  name: string
  url: string
}

export type HeaderNavModule = 'rankings' | 'pricing'

export type HeaderNavModules = {
  home: boolean
  console: boolean
  pricing: ModuleAccess
  rankings: ModuleAccess
  docs: boolean
  about: boolean
  customLinks: HeaderNavCustomLink[]
  order: string[]
}

export const DEFAULT_HEADER_NAV_MODULES: HeaderNavModules = {
  home: true,
  console: true,
  pricing: { enabled: true, requireAuth: false },
  rankings: { enabled: true, requireAuth: false },
  docs: true,
  about: true,
  customLinks: [],
  order: [...HEADER_NAV_BUILTIN_KEYS],
}

const DEFAULTS: Record<HeaderNavModule, ModuleAccess> = {
  pricing: DEFAULT_HEADER_NAV_MODULES.pricing,
  rankings: DEFAULT_HEADER_NAV_MODULES.rankings,
}

export function getCustomHeaderNavRef(id: string): string {
  return `${HEADER_NAV_CUSTOM_PREFIX}${id}`
}

export function getCustomHeaderNavId(reference: string): string | null {
  if (!reference.startsWith(HEADER_NAV_CUSTOM_PREFIX)) return null
  const id = reference.slice(HEADER_NAV_CUSTOM_PREFIX.length)
  return id || null
}

export function cloneHeaderNavDefaults(): HeaderNavModules {
  return {
    ...DEFAULT_HEADER_NAV_MODULES,
    pricing: { ...DEFAULT_HEADER_NAV_MODULES.pricing },
    rankings: { ...DEFAULT_HEADER_NAV_MODULES.rankings },
    customLinks: [],
    order: [...DEFAULT_HEADER_NAV_MODULES.order],
  }
}

export function parseHeaderNavBoolean(
  raw: unknown,
  fallback: boolean
): boolean {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') {
    if (raw === 1) return true
    if (raw === 0) return false
    return fallback
  }
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0') return false
  }
  return fallback
}

function parseAccess(raw: unknown, fallback: ModuleAccess): ModuleAccess {
  if (
    typeof raw === 'boolean' ||
    typeof raw === 'number' ||
    typeof raw === 'string'
  ) {
    return {
      enabled: parseHeaderNavBoolean(raw, fallback.enabled),
      requireAuth: fallback.requireAuth,
    }
  }
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    return {
      enabled: parseHeaderNavBoolean(record.enabled, fallback.enabled),
      requireAuth: parseHeaderNavBoolean(
        record.requireAuth,
        fallback.requireAuth
      ),
    }
  }
  return { ...fallback }
}

function parseCustomLinks(
  parsed: Record<string, unknown>
): HeaderNavCustomLink[] {
  const rawLinks = Array.isArray(parsed.customLinks) ? parsed.customLinks : []
  const candidates = [...rawLinks]

  if (
    candidates.length === 0 &&
    parsed.customLink &&
    typeof parsed.customLink === 'object'
  ) {
    const legacy = parsed.customLink as Record<string, unknown>
    if (legacy.name || legacy.url) {
      candidates.push({ ...legacy, id: 'legacy-custom-link' })
    }
  }

  const usedIds = new Set<string>()
  return candidates
    .slice(0, HEADER_NAV_MAX_CUSTOM_LINKS)
    .flatMap((raw, index) => {
      if (!raw || typeof raw !== 'object') return []
      const record = raw as Record<string, unknown>
      const requestedId = typeof record.id === 'string' ? record.id.trim() : ''
      let id = requestedId || `custom-${index + 1}`
      while (usedIds.has(id)) id = `${id}-${index + 1}`
      usedIds.add(id)

      return [
        {
          id,
          enabled: parseHeaderNavBoolean(record.enabled, false),
          name: typeof record.name === 'string' ? record.name.trim() : '',
          url: typeof record.url === 'string' ? record.url.trim() : '',
        },
      ]
    })
}

function parseHeaderNavOrder(
  raw: unknown,
  customLinks: HeaderNavCustomLink[]
): string[] {
  const available = [
    ...HEADER_NAV_BUILTIN_KEYS,
    ...customLinks.map((link) => getCustomHeaderNavRef(link.id)),
  ]
  const allowed = new Set<string>(available)
  const ordered: string[] = []

  if (Array.isArray(raw)) {
    raw.forEach((value) => {
      if (
        typeof value !== 'string' ||
        !allowed.has(value) ||
        ordered.includes(value)
      ) {
        return
      }
      ordered.push(value)
    })
  }

  available.forEach((reference) => {
    if (!ordered.includes(reference)) ordered.push(reference)
  })

  return ordered
}

export function isSafeHeaderNavHref(href: string): boolean {
  const value = href.trim()
  if (value.startsWith('/') && !value.startsWith('//')) return true

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function parseHeaderNavRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || String(raw).trim() === '') return null
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>

  try {
    return JSON.parse(String(raw)) as Record<string, unknown>
  } catch {
    return null
  }
}

export function parseHeaderNavModules(raw: unknown): HeaderNavModules {
  const result = cloneHeaderNavDefaults()
  const parsed = parseHeaderNavRecord(raw)
  if (!parsed) return result

  result.home = parseHeaderNavBoolean(parsed.home, result.home)
  result.console = parseHeaderNavBoolean(parsed.console, result.console)
  result.pricing = parseAccess(parsed.pricing, result.pricing)
  result.rankings = parseAccess(parsed.rankings, result.rankings)
  result.docs = parseHeaderNavBoolean(parsed.docs, result.docs)
  result.about = parseHeaderNavBoolean(parsed.about, result.about)
  result.customLinks = parseCustomLinks(parsed)
  result.order = parseHeaderNavOrder(parsed.order, result.customLinks)

  return result
}

export function parseHeaderNavModulesFromStatus(
  status: Record<string, unknown> | null
): HeaderNavModules {
  return parseHeaderNavModules(status?.HeaderNavModules)
}

function getCachedStatus(): Record<string, unknown> | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem('status')
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function cacheStatus(status: Record<string, unknown> | null): void {
  try {
    if (typeof window !== 'undefined' && status) {
      window.localStorage.setItem('status', JSON.stringify(status))
    }
  } catch {
    /* empty */
  }
}

export function getModuleAccessFromStatus(
  status: Record<string, unknown> | null,
  module: HeaderNavModule
): ModuleAccess {
  return parseHeaderNavModulesFromStatus(status)[module] ?? DEFAULTS[module]
}

export function getModuleAccess(module: HeaderNavModule): ModuleAccess {
  return getModuleAccessFromStatus(getCachedStatus(), module)
}

export async function getFreshModuleAccess(
  module: HeaderNavModule
): Promise<ModuleAccess> {
  try {
    const status = (await getStatus()) as Record<string, unknown> | null
    cacheStatus(status)
    return getModuleAccessFromStatus(status, module)
  } catch {
    return { enabled: false, requireAuth: true }
  }
}

export function isSidebarModuleEnabled(
  section: string,
  module: string
): boolean {
  const status = getCachedStatus()
  if (!status) return true

  const raw = status.SidebarModulesAdmin
  if (!raw || String(raw).trim() === '') return true

  try {
    const parsed = JSON.parse(String(raw)) as Record<
      string,
      Record<string, boolean>
    >
    const sectionConfig = parsed[section]
    if (!sectionConfig) return true
    if (sectionConfig.enabled === false) return false
    if (sectionConfig[module] === false) return false
    return true
  } catch {
    return true
  }
}
