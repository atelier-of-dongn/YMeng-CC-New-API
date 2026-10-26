import { createInstance } from 'i18next'
import { expect, it } from 'vitest'

import en from '../locales/en.json'
import fr from '../locales/fr.json'
import ja from '../locales/ja.json'
import ru from '../locales/ru.json'
import vi from '../locales/vi.json'
import zhTW from '../locales/zh-TW.json'
import zhCN from '../locales/zh.json'

const resources = { en, zhCN, zhTW, fr, ru, ja, vi }

it.each(Object.entries(resources))(
  'resolves invoice submission and available commission in %s',
  async (language, resource) => {
    const i18n = createInstance()
    await i18n.init({
      lng: language,
      fallbackLng: 'en',
      resources: { [language]: resource, en },
    })

    for (const key of ['Submit invoice application', 'Available commission']) {
      expect(i18n.exists(key, { lng: language })).toBe(true)
      if (language !== 'en') expect(i18n.t(key)).not.toBe(key)
    }
  }
)

it('uses the requested Chinese translations', async () => {
  const i18n = createInstance()
  await i18n.init({ lng: 'zhCN', fallbackLng: 'en', resources })

  expect(i18n.t('Submit invoice application')).toBe('提交发票申请')
  expect(i18n.t('Available commission')).toBe('可用佣金')

  await i18n.changeLanguage('zhTW')
  expect(i18n.t('Submit invoice application')).toBe('提交發票申請')
  expect(i18n.t('Available commission')).toBe('可用佣金')
})
