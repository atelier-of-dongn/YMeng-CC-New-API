#!/usr/bin/env python3
"""为钱包推广卡片改版新增的文案补齐各语言翻译。

仅追加缺失键，保持原有键顺序，避免产生大范围无关 diff。
"""
import json
import pathlib

LOCALES_DIR = pathlib.Path(__file__).resolve().parent.parent / "src/i18n/locales"

TRANSLATIONS = {
    "Available": {
        "zh": "可用",
        "zhTW": "可用",
    },
    "View commission details": {
        "zh": "查看佣金明细",
        "zhTW": "檢視佣金明細",
    },
    "Earn commission when your invited users spend wallet balance. Transfer accumulated commission to your balance anytime.": {
        "zh": "被邀请用户使用钱包余额消费时你可获得佣金，累计佣金可随时转入余额。",
        "zhTW": "被邀請使用者使用錢包餘額消費時你可獲得佣金，累計佣金可隨時轉入餘額。",
    },
}

LANG_FILES = {
    "en": "en.json",
    "zh": "zh.json",
    "zhTW": "zh-TW.json",
    "fr": "fr.json",
    "ru": "ru.json",
    "ja": "ja.json",
    "vi": "vi.json",
}


def main() -> None:
    for lang, filename in LANG_FILES.items():
        path = LOCALES_DIR / filename
        data = json.loads(path.read_text(encoding="utf-8"))
        translation = data["translation"]

        added = 0
        for key, values in TRANSLATIONS.items():
            if key in translation:
                continue
            translation[key] = values.get(lang, key)
            added += 1

        if added:
            out = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
            # 还原源文件中原有的 \u0061 转义，保持与原文件一致。
            out = out.replace(
                '"footer.newapi.projectAttributionSuffix"',
                '"footer.new\\u0061pi.projectAttributionSuffix"',
            )
            path.write_text(out, encoding="utf-8")
        print(f"{filename}: +{added} keys, total {len(translation)}")


if __name__ == "__main__":
    main()