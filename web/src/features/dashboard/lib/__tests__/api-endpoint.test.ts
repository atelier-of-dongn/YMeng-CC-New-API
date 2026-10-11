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
import { describe, expect, it } from 'vitest'

import { normalizeApiBaseUrl, normalizeEndpoint } from '../api-endpoint'

describe('normalizeApiBaseUrl', () => {
  it('falls back to the current origin with the v1 path', () => {
    expect(normalizeApiBaseUrl()).toBe(`${window.location.origin}/v1`)
  })

  it('adds the v1 path to a configured host', () => {
    expect(normalizeApiBaseUrl('https://api.example.com')).toBe(
      'https://api.example.com/v1'
    )
  })

  it('keeps only the v1 path from a complete request URL', () => {
    expect(
      normalizeApiBaseUrl('https://api.example.com/v1/chat/completions')
    ).toBe('https://api.example.com/v1')
  })

  it('removes trailing slashes from an existing v1 URL', () => {
    expect(normalizeApiBaseUrl('https://api.example.com/v1///')).toBe(
      'https://api.example.com/v1'
    )
  })

  it('supports deployment prefixes and removes suffixes after v1', () => {
    expect(normalizeApiBaseUrl('https://api.example.com/proxy/v1/models')).toBe(
      'https://api.example.com/proxy/v1'
    )
  })

  it('does not treat another version such as v10 as v1', () => {
    expect(normalizeApiBaseUrl('https://api.example.com/v10')).toBe(
      'https://api.example.com/v10/v1'
    )
  })
})

describe('normalizeEndpoint', () => {
  it('falls back to the current origin when no API URL is configured', () => {
    expect(normalizeEndpoint()).toBe(
      `${window.location.origin}/v1/chat/completions`
    )
  })

  it('adds the default API path to a configured host', () => {
    expect(normalizeEndpoint('https://api.example.com')).toBe(
      'https://api.example.com/v1/chat/completions'
    )
  })

  it('adds the chat completions path to a configured v1 URL', () => {
    expect(normalizeEndpoint('https://api.example.com/v1')).toBe(
      'https://api.example.com/v1/chat/completions'
    )
  })

  it('preserves a complete chat completions URL', () => {
    expect(
      normalizeEndpoint('https://api.example.com/v1/chat/completions')
    ).toBe('https://api.example.com/v1/chat/completions')
  })

  it('removes trailing slashes before adding or preserving the API path', () => {
    expect(normalizeEndpoint('https://api.example.com///')).toBe(
      'https://api.example.com/v1/chat/completions'
    )
    expect(
      normalizeEndpoint('https://api.example.com/v1/chat/completions///')
    ).toBe('https://api.example.com/v1/chat/completions')
  })
})
