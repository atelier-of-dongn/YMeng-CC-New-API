const BAOCODE_IMPORT_URL = 'https://baocode.dev/import'

export type BaoCodeProtocol = 'anthropic' | 'openai-chat' | 'openai-responses'

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
