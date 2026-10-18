import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createInstance } from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import type { LogRequestParameters, RequestParameterValue } from '../../types'
import { RequestParametersSection } from './request-parameters-section'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })

function renderSection(
  requestParameters?: LogRequestParameters | null
): string {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <RequestParametersSection requestParameters={requestParameters} />
    </I18nextProvider>
  )
}

describe('RequestParametersSection', () => {
  test('does not add a section to historical logs without request parameters', () => {
    assert.equal(renderSection(), '')
    assert.equal(renderSection(null), '')
  })

  test('starts collapsed and displays indented JSON with a copy action', () => {
    const html = renderSection({ parameters: { model: 'image-model', n: 1 } })
    assert.match(html, /<details[^>]*>/)
    assert.doesNotMatch(html, /<details[^>]*\bopen/)
    assert.match(html, /<summary[^>]*>Request Parameters<\/summary>/)
    assert.match(
      html,
      /\{\n {2}&quot;model&quot;: &quot;image-model&quot;,\n {2}&quot;n&quot;: 1\n\}/
    )
    assert.match(html, /<button[^>]*>.*Copy to clipboard<\/button>/)
    assert.doesNotMatch(html, /role="note"/)
  })

  test('escapes prompt markup instead of rendering executable HTML', () => {
    const html = renderSection({
      parameters: { prompt: '<script>alert(1)</script>' },
    })
    assert.doesNotMatch(html, /<script>/)
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  })

  const values: RequestParameterValue[] = [
    null,
    false,
    0,
    '',
    [],
    { seconds: 0, watermark: false },
  ]
  for (const parameters of values) {
    test(`preserves JSON value ${JSON.stringify(parameters)}`, () => {
      const html = renderSection({ parameters })
      const expected = renderToStaticMarkup(
        <span>{JSON.stringify(parameters, null, 2)}</span>
      )
        .replace('<span>', '')
        .replace('</span>', '')
      assert.ok(html.includes(`>${expected}</pre>`))
      assert.match(html, /Copy to clipboard/)
    })
  }

  test('warns about both truncation and omissions while preserving the recorded subset', () => {
    const html = renderSection({
      parameters: { prompt: 'partial' },
      truncated: true,
      omitted: true,
    })
    assert.match(
      html,
      /Request parameters were truncated\. This is not the complete request\./
    )
    assert.match(html, /Some request parameters were omitted from this log\./)
    assert.match(html, /&quot;prompt&quot;: &quot;partial&quot;/)
  })

  test('shows omission warnings independently of truncation', () => {
    const html = renderSection({ parameters: null, omitted: true })
    assert.match(html, /Some request parameters were omitted from this log\./)
    assert.doesNotMatch(html, /Request parameters were truncated/)
  })
})
