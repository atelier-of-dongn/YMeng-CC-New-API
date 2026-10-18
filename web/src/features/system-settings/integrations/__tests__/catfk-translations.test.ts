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
      'Check status',
      'Waiting for payment confirmation',
      'Click here if payment did not open',
      'Payment successful',
      'Automatically credited {{amount}}. No redemption needed.',
      'Unable to check payment status. Retrying automatically.',
      'Contact method',
      'Enter QQ number (5-12 digits)',
      'Custom amounts are not supported',
      'Yunmao consignment store payments',
      'Match each product’s expected credited balance (USD) to an amount option in General. Use the balance value, not the CNY selling price or converted display amount. Unmatched presets cannot use this payment method.',
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
  expect(i18n.t('Check status')).toBe('查询状态')
  expect(i18n.t('Waiting for payment confirmation')).toBe('等待付款确认')
  expect(i18n.t('Click here if payment did not open')).toBe(
    '若未跳转支付请点击'
  )
  expect(i18n.t('Payment successful')).toBe('支付成功')
  expect(
    i18n.t('Automatically credited {{amount}}. No redemption needed.', {
      amount: '¥70',
    })
  ).toBe('自动到账¥70，无需兑换')
  expect(i18n.t('Contact method')).toBe('联系方式')
  expect(i18n.t('Enter QQ number (5-12 digits)')).toBe(
    '请输入QQ号（5-12位数字）'
  )
  expect(i18n.t('Custom amounts are not supported')).toBe('不支持自定义金额')
  expect(i18n.t('Enable CatFK')).toBe('启用云猫支付')
  expect(i18n.t('Yunmao consignment store payments')).toBe('云猫寄售店铺支付')
  await i18n.changeLanguage('en')
  expect(i18n.t('Enable CatFK')).toBe('Enable Yunmao payments')
  await i18n.changeLanguage('zh-TW')
  expect(i18n.t('Custom amounts are not supported')).toBe('不支援自訂金額')
})
