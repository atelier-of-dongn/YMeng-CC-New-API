import fs from 'node:fs/promises'
import path from 'node:path'

const LOCALES_DIR = path.resolve('src/i18n/locales')

function stableStringify(obj) {
  return JSON.stringify(obj, null, 2) + '\n'
}

const newKeys = {
  en: {
    'Internal account profit/loss': 'Internal account profit/loss',
    'JiaSu Seedance': 'JiaSu Seedance',
    'Request Parameters': 'Request Parameters',
    'Request parameters were truncated. This is not the complete request.':
      'Request parameters were truncated. This is not the complete request.',
    'Some request parameters were omitted from this log.':
      'Some request parameters were omitted from this log.',
  },
  zh: {
    'Internal account profit/loss': '内部账号盈亏',
    'JiaSu Seedance': '佳速 Seedance',
    'Request Parameters': '请求参数',
    'Request parameters were truncated. This is not the complete request.':
      '请求参数已截断，这不是完整请求。',
    'Some request parameters were omitted from this log.':
      '部分请求参数未记录在此日志中。',
  },
  fr: {
    'Internal account profit/loss': 'Résultat du compte interne',
    'JiaSu Seedance': 'JiaSu Seedance',
    'Request Parameters': 'Paramètres de la requête',
    'Request parameters were truncated. This is not the complete request.':
      'Les paramètres ont été tronqués. La requête n’est pas complète.',
    'Some request parameters were omitted from this log.':
      'Certains paramètres ne figurent pas dans ce journal.',
  },
  ja: {
    'Internal account profit/loss': '内部アカウントの損益',
    'JiaSu Seedance': 'JiaSu Seedance',
    'Request Parameters': 'リクエストパラメーター',
    'Request parameters were truncated. This is not the complete request.':
      'リクエストパラメーターは切り詰められています。完全なリクエストではありません。',
    'Some request parameters were omitted from this log.':
      '一部のリクエストパラメーターはこのログに記録されていません。',
  },
  ru: {
    'Internal account profit/loss': 'Прибыль/убыток внутреннего аккаунта',
    'JiaSu Seedance': 'JiaSu Seedance',
    'Request Parameters': 'Параметры запроса',
    'Request parameters were truncated. This is not the complete request.':
      'Параметры запроса усечены. Это неполный запрос.',
    'Some request parameters were omitted from this log.':
      'Некоторые параметры запроса не записаны в этот журнал.',
  },
  vi: {
    'Internal account profit/loss': 'Lãi/lỗ tài khoản nội bộ',
    'JiaSu Seedance': 'JiaSu Seedance',
    'Request Parameters': 'Tham số yêu cầu',
    'Request parameters were truncated. This is not the complete request.':
      'Tham số yêu cầu đã bị cắt bớt. Đây không phải yêu cầu đầy đủ.',
    'Some request parameters were omitted from this log.':
      'Một số tham số yêu cầu đã bị bỏ qua khỏi nhật ký này.',
  },

  'zh-TW': {
    'Internal account profit/loss': '內部帳號損益',
    'Request Parameters': '請求參數',
    'Request parameters were truncated. This is not the complete request.':
      '請求參數已截斷，這不是完整請求。',
    'Some request parameters were omitted from this log.':
      '部分請求參數未記錄在此日誌中。',
  },
}

async function main() {
  let totalAdded = 0

  for (const [locale, trans] of Object.entries(newKeys)) {
    const filePath = path.join(LOCALES_DIR, `${locale}.json`)
    const json = JSON.parse(await fs.readFile(filePath, 'utf8'))

    let count = 0
    for (const [key, value] of Object.entries(trans)) {
      if (!Object.prototype.hasOwnProperty.call(json.translation, key)) {
        json.translation[key] = value
        count++
      } else if (json.translation[key] !== value) {
        json.translation[key] = value
        count++
      }
    }

    if (count > 0) {
      json.translation = Object.fromEntries(
        Object.entries(json.translation).sort(([a], [b]) => a.localeCompare(b))
      )
      await fs.writeFile(filePath, stableStringify(json), 'utf8')
    }

    console.log(`${locale}: ${count} translations applied`)
    totalAdded += count
  }

  console.log(`\nTotal: ${totalAdded} translations applied`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
