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

function getCurrentOrigin(): string {
  if (typeof window === 'undefined') return ''
  return window.location.origin
}

export function normalizeApiBaseUrl(sourceUrl?: string): string {
  const fallback = `${getCurrentOrigin()}/v1`
  const trimmed = sourceUrl?.trim()
  if (!trimmed) return fallback

  const withoutTrailingSlash = trimmed.replace(/\/+$/, '')
  const v1Match = withoutTrailingSlash.match(/^(.*\/v1)(?:\/|$)/)
  if (v1Match) return v1Match[1]

  return `${withoutTrailingSlash}/v1`
}

export function normalizeEndpoint(sourceUrl?: string): string {
  return `${normalizeApiBaseUrl(sourceUrl)}/chat/completions`
}
