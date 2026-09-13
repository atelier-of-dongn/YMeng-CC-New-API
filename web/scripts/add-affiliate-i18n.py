#!/usr/bin/env python3
"""为新增/遗漏的界面文案补齐各语言翻译。

仅新增缺失键，不覆盖已有翻译，避免影响既有本地化成果。
"""
import json
import pathlib

LOCALES_DIR = pathlib.Path(__file__).resolve().parent.parent / "src/i18n/locales"

# key -> 各语言文案；en 使用键本身时可省略。
TRANSLATIONS = {
    # ---- 大陆 IP 网页可见性（原本缺失中文，导致界面显示英文） ----
    "Mainland IP Web Visibility": {
        "zh": "大陆 IP 网页可见性",
        "zhTW": "大陸 IP 網頁可見性",
    },
    "Enable Mainland IP UI filtering": {
        "zh": "启用大陆 IP 网页过滤",
        "zhTW": "啟用大陸 IP 網頁過濾",
    },
    "When enabled, Mainland China users only see the selected groups in the web interface. Model API calls are never restricted.": {
        "zh": "启用后，中国大陆用户在网页中只能看到所选分组。模型 API 调用不受任何限制。",
        "zhTW": "啟用後，中國大陸使用者在網頁中只能看到所選分組。模型 API 呼叫不受任何限制。",
    },
    "Groups allowed for Mainland IPs": {
        "zh": "允许大陆 IP 查看的分组",
        "zhTW": "允許大陸 IP 檢視的分組",
    },
    "Select allowed groups": {
        "zh": "选择允许的分组",
        "zhTW": "選擇允許的分組",
    },
    "The list controls web visibility only. An empty list hides every model group from Mainland China users; API Key calls remain unaffected.": {
        "zh": "该列表仅控制网页展示范围。留空会对大陆用户隐藏所有模型分组；使用 API Key 调用不受影响。",
        "zhTW": "該列表僅控制網頁顯示範圍。留空會對大陸使用者隱藏所有模型分組；使用 API Key 呼叫不受影響。",
    },
    "Save IP visibility settings": {
        "zh": "保存网页可见性设置",
        "zhTW": "儲存網頁可見性設定",
    },
    # ---- 推广佣金 ----
    "Affiliate Commission": {
        "zh": "推广佣金",
        "zhTW": "推廣佣金",
    },
    "Enable affiliate commission": {
        "zh": "启用推广佣金",
        "zhTW": "啟用推廣佣金",
    },
    "When disabled, no new commission is settled. Existing balances and history stay untouched.": {
        "zh": "关闭后不再产生新的佣金结算，已有余额与历史记录保持不变。",
        "zhTW": "關閉後不再產生新的佣金結算，已有餘額與歷史記錄保持不變。",
    },
    "Commission rate (%)": {
        "zh": "佣金比例（%）",
        "zhTW": "佣金比例（%）",
    },
    "Percentage of the invitee consumption credited to the inviter. Allowed range is 0 to 100.": {
        "zh": "按被邀请人消费额的该比例计入邀请人账户，取值范围 0 到 100。",
        "zhTW": "按被邀請人消費額的該比例計入邀請人帳戶，取值範圍 0 到 100。",
    },
    "Commission is settled after each successful billing: the inviter receives the configured percentage of the invitee consumption. Amounts below one quota unit are carried over to the next settlement.": {
        "zh": "每次计费成功后结算佣金：邀请人按设定比例获得被邀请人消费额的返佣。不足 1 额度的小数部分会结转到下一次结算。",
        "zhTW": "每次計費成功後結算佣金：邀請人按設定比例獲得被邀請人消費額的返佣。不足 1 額度的小數部分會結轉到下一次結算。",
    },
    "Save affiliate settings": {
        "zh": "保存推广设置",
        "zhTW": "儲存推廣設定",
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
            # 未提供该语言译文时回落到英文原文，保证键存在且可读。
            translation[key] = values.get(lang, key)
            added += 1

        if added:
            # 保持原有键顺序，仅在末尾追加，避免产生大范围无关 diff。
            path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        print(f"{filename}: +{added} keys, total {len(translation)}")


if __name__ == "__main__":
    main()