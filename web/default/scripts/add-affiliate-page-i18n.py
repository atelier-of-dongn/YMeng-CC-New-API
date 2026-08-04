#!/usr/bin/env python3
"""为用户端推广页面补齐各语言文案。

仅追加缺失键，保持原有键顺序，避免产生大范围无关 diff。
"""
import json
import pathlib

LOCALES_DIR = pathlib.Path(__file__).resolve().parent.parent / "src/i18n/locales"

TRANSLATIONS = {
    "Available commission": {
        "zh": "可用佣金",
        "zhTW": "可用佣金",
    },
    "Total commission earned": {
        "zh": "累计佣金",
        "zhTW": "累計佣金",
    },
    "Invited users": {
        "zh": "邀请用户",
        "zhTW": "邀請使用者",
    },
    "Commission records": {
        "zh": "佣金记录",
        "zhTW": "佣金記錄",
    },
    "Your referral link": {
        "zh": "你的推广链接",
        "zhTW": "你的推廣連結",
    },
    "Commission rate: {{rate}}%": {
        "zh": "佣金比例：{{rate}}%",
        "zhTW": "佣金比例：{{rate}}%",
    },
    "You earn commission on the wallet balance your invited users spend. Subscription usage does not generate commission. Fractions below one quota unit are carried over to the next settlement.": {
        "zh": "被邀请用户使用钱包余额消费时，你可获得佣金。订阅额度的消耗不产生佣金。不足 1 额度的小数部分会结转到下一次结算。",
        "zhTW": "被邀請使用者使用錢包餘額消費時，你可獲得佣金。訂閱額度的消耗不產生佣金。不足 1 額度的小數部分會結轉到下一次結算。",
    },
    "Carried-over fraction: {{value}}": {
        "zh": "待结转尾数：{{value}}",
        "zhTW": "待結轉尾數：{{value}}",
    },
    "The affiliate program is currently disabled. Existing balances are kept, but no new commission is settled.": {
        "zh": "推广功能当前已关闭。已有余额会保留，但不再产生新的佣金结算。",
        "zhTW": "推廣功能目前已關閉。已有餘額會保留，但不再產生新的佣金結算。",
    },
    "No commission records yet": {
        "zh": "暂无佣金记录",
        "zhTW": "暫無佣金記錄",
    },
    "No invited users yet": {
        "zh": "暂无邀请用户",
        "zhTW": "暫無邀請使用者",
    },
    "Invited user": {
        "zh": "被邀请用户",
        "zhTW": "被邀請使用者",
    },
    "Consumed": {
        "zh": "消费额度",
        "zhTW": "消費額度",
    },
    "Rate": {
        "zh": "比例",
        "zhTW": "比例",
    },
    "Commission": {
        "zh": "佣金",
        "zhTW": "佣金",
    },
    "Registered at": {
        "zh": "注册时间",
        "zhTW": "註冊時間",
    },
    "Records": {
        "zh": "记录数",
        "zhTW": "記錄數",
    },
    "Last reward": {
        "zh": "最近返佣",
        "zhTW": "最近返佣",
    },
    "Showing the latest {{count}} of {{total}} records": {
        "zh": "显示最近 {{count}} 条，共 {{total}} 条",
        "zhTW": "顯示最近 {{count}} 筆，共 {{total}} 筆",
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
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
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