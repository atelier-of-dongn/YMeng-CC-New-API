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
      'Cancel payment',
      'Open Alipay to pay',
      'Waiting for payment confirmation',
      'Payment QR code',
      'Scan with Alipay to pay',
      'Scan with WeChat to pay',
      'Save QR code',
      'Save the QR code, then scan it from your photo album in WeChat',
      'View redemption code',
      'The code redeemed for this order',
      'Redemption code unavailable',
      'Redemption code is not available yet',
      'Payment successful',
      'Includes a {{rate}}% fee ({{fee}})',
      'Unable to check payment status. Retrying automatically.',
      'Contact method',
      'Enter QQ number (5-12 digits)',
      'Custom amounts are not supported',
      'Yunmao consignment store payments',
      'Yunmao payment setup guide',
      'Open Yunmao merchant console',
      'Copy the part of the store link after /shop/ and paste it into the store token field. You can also paste the full store link.',
      'Open the product page and copy the part of the product link after /item/. Paste only this part into the goods key field.',
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
  expect(i18n.t('Cancel payment')).toBe('取消支付')
  expect(i18n.t('Open Alipay to pay')).toBe('打开支付宝付款')
  expect(i18n.t('Waiting for payment confirmation')).toBe('等待付款确认')
  expect(i18n.t('Scan with Alipay to pay')).toBe('请使用支付宝扫码支付')
  expect(i18n.t('Scan with WeChat to pay')).toBe('请使用微信扫码支付')
  expect(i18n.t('Save QR code')).toBe('保存二维码')
  expect(i18n.t('View redemption code')).toBe('查看兑换码')
  expect(i18n.t('Payment successful')).toBe('支付成功')
  expect(
    i18n.t('Includes a {{rate}}% fee ({{fee}})', { rate: '1.8', fee: '0.18' })
  ).toBe('含 1.8% 手续费（0.18）')
  expect(i18n.t('Contact method')).toBe('联系方式')
  expect(i18n.t('Enter QQ number (5-12 digits)')).toBe(
    '请输入QQ号（5-12位数字）'
  )
  expect(i18n.t('Custom amounts are not supported')).toBe('不支持自定义金额')
  expect(i18n.t('Enable CatFK')).toBe('启用云猫支付')
  expect(i18n.t('Yunmao consignment store payments')).toBe('云猫寄售店铺支付')
  expect(i18n.t('Yunmao payment setup guide')).toBe('云猫支付配置教程')
  expect(
    i18n.t(
      'Click {{read}}, select the channels to offer, turn on payments, then click {{save}}.',
      { read: i18n.t('Read CatFK channels'), save: i18n.t('Save all settings') }
    )
  ).toBe(
    '点击“读取 云猫 渠道”，勾选要提供的支付渠道，打开支付开关，然后点击“保存所有设置”。'
  )
  await i18n.changeLanguage('en')
  expect(i18n.t('Enable CatFK')).toBe('Enable Yunmao payments')
  await i18n.changeLanguage('zh-TW')
  expect(i18n.t('Custom amounts are not supported')).toBe('不支援自訂金額')
})
