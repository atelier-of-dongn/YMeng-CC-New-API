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
const BAOCODE_IMPORT_URL = 'https://baocode.dev/import'

export type BaoCodeProtocol = 'anthropic' | 'openai-chat' | 'openai-responses'

const DEFAULT_PROTOCOL: BaoCodeProtocol = 'openai-chat'

let lastProtocol: BaoCodeProtocol = DEFAULT_PROTOCOL

export function getLastBaoCodeProtocol(): BaoCodeProtocol {
  return lastProtocol
}

export function setLastBaoCodeProtocol(protocol: BaoCodeProtocol): void {
  lastProtocol = protocol
}

type BuildBaoCodeImportUrlParams = {
  name: string
  protocol: BaoCodeProtocol
  url: string
  key: string
}

export function buildBaoCodeImportUrl({
  name,
  protocol,
  url,
  key,
}: BuildBaoCodeImportUrlParams): string {
  const params = [
    ['v', '1'],
    ['name', name],
    ['protocol', protocol],
    ['url', url],
    ['key', key],
  ]

  const fragment = params
    .map(([parameter, value]) => `${parameter}=${encodeURIComponent(value)}`)
    .join('&')

  return `${BAOCODE_IMPORT_URL}#${fragment}`
}
