# New API IP Policy Proxy

New API 前置合规策略层。使用 Cloudflare `CF-IPCountry` 判断中国大陆访问，并按 Token 的有效分组控制调用权限。

## 职责

- 透明代理 New API 请求，保留流式输出。
- 仅对中国大陆来源执行分组白名单。
- 复用 New API 管理员登录态提供设置页。
- 设置保存在 New API 现有 `options` 表。
- 不修改或替换现有 `newapi-affiliate` 镜像。

## 配置

- `LISTEN_ADDR`：监听地址，默认 `:3002`。
- `UPSTREAM_URL`：New API 上游，默认 `http://new-api:3000`。
- `SQL_DSN`：MySQL DSN，必填。
- `POLICY_REFRESH_SECONDS`：策略刷新周期，默认 5 秒。

策略设置项：

- `IpAccessPolicyEnabled`
- `IpAccessPolicyAllowedGroups`
- `IpAccessPolicyErrorMessage`