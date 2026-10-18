import { createInstance } from 'i18next'
import { expect, it } from 'vitest'

import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import vi from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zh from '@/i18n/locales/zh.json'

const resources = { en, zh, 'zh-TW': zhTW, fr, ja, ru, vi }

it.each(Object.entries(resources))(
  'resolves gateway labels and validation from the translation namespace in %s',
  async (language, resource) => {
    const i18n = createInstance()
    await i18n.init({
      lng: language,
      fallbackLng: 'en',
      resources: { [language]: resource, en },
    })
    for (const key of [
      'Enable CatFK',
      'CatFK store token',
      'CatFK product mappings',
      'Read CatFK channels',
      'Expected credited balance (USD)',
      'CatFK product IDs must be unique',
      'Custom amounts are not supported',
    ]) {
      expect(i18n.exists(key, { lng: language })).toBe(true)
      expect(i18n.t(key)).not.toContain('CatFK')
      if (language !== 'en') expect(i18n.t(key)).not.toBe(key)
    }
  }
)

it('shows the requested Chinese custom amount note and switches gateway labels with the language', async () => {
  const i18n = createInstance()
  await i18n.init({ lng: 'zh', fallbackLng: 'en', resources })
  expect(i18n.t('Custom amounts are not supported')).toBe('不支持自定义金额')
  expect(i18n.t('Enable CatFK')).toBe('启用云猫支付')
  await i18n.changeLanguage('en')
  expect(i18n.t('Enable CatFK')).toBe('Enable Yunmao payments')
  await i18n.changeLanguage('zh-TW')
  expect(i18n.t('Custom amounts are not supported')).toBe('不支援自訂金額')
})
