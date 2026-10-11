import { describe, expect, it } from 'vitest'

import { buildBaoCodeImportUrl } from '../baocode-import'

describe('buildBaoCodeImportUrl', () => {
  it('encodes every import value in the URL fragment', () => {
    const result = buildBaoCodeImportUrl({
      name: '生产 & key#1',
      protocol: 'openai-chat',
      url: 'https://example.com/proxy/v1',
      key: 'sk-test + value=1',
    })
    const parsed = new URL(result)

    expect(parsed.origin + parsed.pathname).toBe('https://baocode.dev/import')
    expect(parsed.search).toBe('')
    expect(parsed.hash).toBe(
      '#v=1&name=%E7%94%9F%E4%BA%A7%20%26%20key%231&protocol=openai-chat&url=https%3A%2F%2Fexample.com%2Fproxy%2Fv1&key=sk-test%20%2B%20value%3D1'
    )
  })

  it('keeps user values from creating additional fragment parameters', () => {
    const result = buildBaoCodeImportUrl({
      name: 'name&protocol=anthropic',
      protocol: 'anthropic',
      url: 'https://example.com/#fragment?x=1',
      key: 'sk-key%26#=',
    })

    expect(result.split('#')[1]).toBe(
      'v=1&name=name%26protocol%3Danthropic&protocol=anthropic&url=https%3A%2F%2Fexample.com%2F%23fragment%3Fx%3D1&key=sk-key%2526%23%3D'
    )
  })
})
