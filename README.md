<div align="center">

# YMeng CC New API

![new-api](/web/public/logo.png)

<h2><a href="https://ymeng.cc">YMeng API 中转站 · ymeng.cc</a></h2>

<p><strong>访问中转站：<a href="https://ymeng.cc">https://ymeng.cc</a></strong></p>

为 YMeng API 中转服务开发与维护的 New API 二次开发版本

**渠道路由 · 发票管理 · 邀请返佣 · 上游成本分析**

[本仓库](https://github.com/atelier-of-dongn/YMeng-CC-New-API) | [上游项目](https://github.com/QuantumNous/new-api) | [简体中文上游介绍](./README.zh_CN.md) | [English](./README.en.md)

[分支说明](#fork-overview) | [分支部署](#fork-deployment) | [使用流程](#fork-usage) | [常见问题](#fork-faq) | [上游参考](#upstream-reference)

</div>

<a id="fork-overview"></a>

## 分支说明

本仓库是 [QuantumNous/new-api](https://github.com/QuantumNous/new-api) 的二次开发版本。下方先介绍本分支的使用方式，再保留上游功能、部署参考与致谢信息。

> [!IMPORTANT]
> 上游官方镜像 `calciumion/new-api:latest` 不包含本仓库的定制修改。部署前请确认使用的代码分支和镜像来源；下方上游快速开始仅用于部署官方 New API。

### 本分支功能

本分支直接集成在 New API 网关中，沿用其请求转发、流式输出、管理员认证与设置存储，不是独立部署的外置代理。

| 功能 | 说明与使用入口 |
| --- | --- |
| [发票申请与管理](#fork-invoices) | 用户选择充值订单申请发票；管理员处理、驳回、上传 PDF，支持搜索、预览下载、Excel 导出与开票邮件 |
| [邀请消费返佣](#fork-affiliate) | 邀请链接、受邀用户与佣金明细，按钱包消费结算推广佣金，推广额度可转入钱包 |
| [管理员推荐看板](#fork-affiliate) | 按时间查看推荐注册与佣金统计、趋势、邀请人排行，搜索与筛选佣金明细 |
| [API Key 有序多分组](#fork-key-routing) | 配置分组调用顺序，开启跨组重试后按顺序切换分组，跳过无可用渠道的分组 |
| [日志请求参数追溯](#fork-operations) | 在日志详情查看与复制保存的请求参数，并显示截断或省略提示 |
| [网页地区可见性](#fork-region) | 根据可信边缘国家码过滤大陆访客的网页分组与模型展示；模型 API 调用不受限制 |
| [上游自动监控与倍率成本](#fork-cost) | 查看兼容 New API 上游的分组、倍率、余额与定价状态，估算成本并匹配上游消费日志 |
| [收益与内部账号盈亏](#fork-cost) | 管理员查看收入、成本、利润、毛利率、覆盖率，可切换内部账号消费的统计口径 |
| [固定按请求成本](#fork-cost) | 配置渠道 `USD/request` 采购成本；仅 `feat/upstream-request-cost` 分支提供 |
| [运营告警与站点配置](#fork-operations) | 飞书成本告警、自定义顶部导航与排序、按支付方式设置充值提示 |

### 分支与版本

| 分支 | 功能范围 |
| --- | --- |
| `ip-policy`（仓库默认分支） | 上表中的共有功能，包括发票、消费返佣、推荐看板、令牌路由、地区可见性和倍率成本监控 |
| `feat/upstream-request-cost` | 继承共有功能，并增加固定 `USD/request` 上游采购成本模式 |

### 继承上游的基础能力

除上述定制功能外，本仓库保留 New API 的多模型接入、协议转换、渠道管理、用户与额度管理等基础能力：

- **认证与安全管理**：登录设备与会话管理、Passkey、TOTP、面板 Access Token 及审计日志。用户入口 `/security`，审计日志入口 `/usage-logs/audit`；详见[认证与登录会话说明](./docs/authentication.md)。
- **任务插件与任务管理**：超级管理员通过 `/task-plugins` 管理插件版本、启停、激活与试运行，渠道可绑定任务插件。插件接入规范见 [Task Plugin API v1](./docs/plugin-api/v1.md)，具体服务能力由安装的插件提供。
- **表达式定价**：支持阶梯、缓存、多模态、时间条件与任务用量等计费表达式，并可配置零输出 Token 时的计费策略。详见[计费表达式说明](./pkg/billingexpr/expr.md)。用户侧计费与上游采购成本分别配置。

> [!NOTE]
> “记录每次请求的成本”与“按请求固定单价”是两个概念。倍率模式也记录请求成本；按请求模式则不按 Token 用量计算，而使用管理员填写的固定单价。上游成本监控不替代用户侧计费规则。

现有 `newapi-affiliate` 镜像不会因为克隆本仓库而自动更新；请分别管理已有实例与本分支构建的镜像。

<a id="fork-deployment"></a>

## 分支部署

### 从本仓库构建

需要 Git、Docker 与 Docker Compose v2。镜像构建会同时编译前端和 Go 后端，无需在宿主机单独安装 Bun 或 Go。

```bash
# 克隆默认分支
git clone --branch ip-policy https://github.com/atelier-of-dongn/YMeng-CC-New-API.git
cd newapi-ip-policy

# 记录部署版本；生产环境建议检出经过验证的具体提交或标签
git rev-parse HEAD
docker build -t new-api-ip-policy:local .
```

如需固定按请求成本模式，在构建前切换到对应功能分支，再记录提交并构建镜像：

```bash
git switch feat/upstream-request-cost
git rev-parse HEAD
docker build -t new-api-ip-policy:local .
```

在仓库的 `docker-compose.yml` 中，将 `new-api` 服务的 `image` 改为本地构建的镜像：

```yaml
services:
  new-api:
    image: new-api-ip-policy:local
```

以上只展示需要修改的字段，**不是完整 Compose 配置**。保留仓库文件中的其他服务、环境变量、挂载与网络配置。该模板默认使用 PostgreSQL 与 Redis；原有 `calciumion/new-api:latest` 是上游官方镜像，不包含本分支修改。

启动前检查：

- 修改 PostgreSQL 与 Redis 的示例密码，并同步修改 `SQL_DSN`、`REDIS_CONN_STRING` 中的凭据。
- 保留 `./data:/data`、`./logs:/app/logs` 与数据库持久化卷；升级前备份数据库、数据目录和部署配置。
- 生产环境通过 HTTPS 反向代理访问，设置随机且稳定的 `SESSION_SECRET`，按下方环境变量说明配置 Secure Cookie 与可信 Origin。
- 根据实际代理拓扑配置 `TRUSTED_PROXIES`，限制源站直连；地区国家码必须由可信边缘节点提供。
- 现有部署升级前先在测试实例验证。不要删除数据库卷，也不要在生产数据上直接尝试未经验证的降级。

```bash
docker compose config --quiet
docker compose up -d
docker compose ps
curl -fsS http://localhost:3000/api/status
```

访问 `http://localhost:3000` 完成初始化。状态接口应返回 `success: true`；还应登录后台检查分支功能是否存在，避免误用上游镜像。

### 多节点运行

所有节点使用相同版本、主数据库与 `SESSION_SECRET`；共享 Redis 的节点还需使用一致的 `CRYPTO_SECRET`。每个节点记录自己转发请求的成本，上游轮询由主节点执行，部署时需确保有主节点运行。认证与缓存传播的详细说明见下方多机部署参考。

<a id="fork-usage"></a>

## 使用流程

### 常用入口

以下路径相对于你部署的站点地址；菜单可见性取决于账号权限与站点配置。

| 操作 | 入口 |
| --- | --- |
| 用户发票申请与下载 | `/invoices` |
| 管理员发票处理 | `/admin-invoices` |
| 用户邀请与佣金明细 | `/affiliate`，钱包中的推广奖励卡片 |
| 管理员推荐统计 | `/affiliate-admin` |
| API Key 分组顺序与跨组重试 | `/keys` 的新建或编辑窗口 |
| 上游收益、内部账号盈亏与请求参数 | 管理员使用日志及日志详情 |
| 返佣比例、成本监控、导航和充值提示 | 管理后台对应设置栏目 |

<a id="fork-invoices"></a>

### 发票申请与管理

1. 用户进入“发票”，选择符合条件的成功充值订单，填写发票抬头和税号后提交申请。
2. 系统计算可申请净额并扣减相关退款；当前申请净额须大于 500，具体可选订单以页面结果为准。
3. 管理员在发票管理中处理申请，可填写原因驳回，或上传开具好的 PDF 完成发票交付。
4. 用户可查看状态、预览和下载 PDF；管理员可搜索申请、导出 Excel，开票后系统尝试通过邮件发送发票。

这是发票申请和文件交付流程。实际开票由运营方完成；邮件交付需要正确配置邮件服务，发送失败时仍可从页面下载。

<a id="fork-affiliate"></a>

### 邀请消费返佣与推荐看板

1. 管理员在计费设置的“推广佣金”中启用返佣，并配置消费佣金比例。
2. 用户在邀请页面获取邀请链接，查看受邀用户、消费佣金明细和推广额度，可将推广额度转入钱包使用。
3. 管理员在推荐看板按时间范围查看推荐注册、已完成佣金、趋势与邀请人排行，并搜索、筛选明细。

配置项为 `affiliate_setting.enabled` 和 `affiliate_setting.commission_rate_percent`。佣金按受邀用户的**钱包余额消费**结算，订阅额度消耗不计佣。推广额度转入钱包供站内使用，页面不提供现金提现流程。

<a id="fork-key-routing"></a>

### API Key 有序分组与跨组重试

在令牌的新建或编辑窗口配置分组序列，并调整调用顺序。请求优先选择序列靠前的可用分组；当前模型或路径没有可用渠道的分组会被跳过。

开启“跨分组重试”后，当前组的重试预算耗尽可进入下一组。组内重试次数仍由系统的失败重试配置控制；跨组重试不保证上游请求必然成功，建议结合日志检查最终使用的分组和渠道。

<a id="fork-region"></a>

### 网页地区可见性

1. 在管理后台的安全设置中打开“大陆 IP 网页可见性”。
2. 启用“大陆 IP 网页过滤”，选择允许大陆访客查看的分组并保存。
3. 通过可信边缘节点分别以大陆与非大陆来源访问，检查网页模型与分组展示。

| 配置项 | 说明 |
| --- | --- |
| `IpAccessPolicyEnabled` | 网页过滤开关，默认关闭 |
| `IpAccessPolicyAllowedGroups` | 允许展示的分组，保存格式为 JSON 字符串数组，例如 `["default", "domestic"]` |

国家码优先读取 `X-Client-Country`，其次读取 `CF-IPCountry`。应用不会自行执行 GeoIP 查询；只有开启过滤且国家码为 `CN` 时生效，国家码缺失或未知时不进行地区过滤。

> [!WARNING]
> 国家码请求头不是客户端身份凭据。边缘节点应覆盖客户端自行提交的这两个请求头，并限制绕过边缘直接访问源站。`TRUSTED_PROXIES` 不会自动验证国家码头的来源。此功能只控制网页可见性，不能作为 API 授权、防火墙或合规准入机制。

<a id="fork-cost"></a>

### 上游成本监控与收益分析

倍率成本监控在默认分支可用；固定按请求成本模式需要部署 `feat/upstream-request-cost` 分支。

1. 在“运营设置 → 日志维护”开启“记录额度消费”，保证消费日志可用。
2. 在“运营设置 → 上游成本监控”开启全局监控，按需配置自动发现、轮询周期与飞书通知。
3. 在渠道的上游监控设置中选择自动、手动或关闭。按请求功能分支还可选择成本计算方式。
4. 倍率模式下，自动模式尝试识别兼容的 New API 上游；无法自动获取时，可使用手动倍率。在按请求功能分支选择按请求模式时，填写固定的 `USD/request` 单价。
5. 查看渠道监控详情与管理员使用日志，结合成本状态和覆盖率解读收益数据。

| 成本计算方式 | 数据来源 | 适用场景与限制 |
| --- | --- | --- |
| 倍率 | 上游定价、分组倍率或手动倍率；可匹配的上游消费日志 | 自动监控依赖上游接口兼容性和权限；未匹配的记录仍为估算 |
| 按请求 | 管理员设置的固定美元单价 | 每条消费日志记录一次固定成本，包括任务提交；后续调整和退款不会改变该固定成本，不参与上游日志匹配 |

默认配置：

| 设置 | 默认值 |
| --- | --- |
| 全局监控 | 关闭 |
| 自动发现 | 开启，但需先启用全局监控 |
| 日志轮询周期 | 60 秒 |
| 定价刷新周期 | 5 分钟 |
| 成本记录保留期 | 30 天 |
| 飞书通知 | 未配置，按需启用 |

> [!IMPORTANT]
> 成本记录可能处于已匹配、估算或未知状态。固定按请求成本始终属于配置估算；未知或未覆盖的请求不能当作零成本。收益数据应结合覆盖率、筛选范围与记录保留期使用，不应视为上游账单或最终结算凭据。

#### 内部账号盈亏口径

管理员使用日志中的“内部账号盈亏”开关默认关闭，并在浏览器本地保存偏好。开启后，内部账号的请求保留上游成本、不计收入，便于把自用消耗纳入运营盈亏。当前内部账号固定为用户 ID `1`；统计时仍需关注估算、未知成本与覆盖率。

<a id="fork-operations"></a>

### 日志追溯与运营配置

- **请求参数追溯**：在使用或任务日志详情查看、复制保存的请求参数；参数被截断或省略时会显示提示。排查问题时结合请求 ID、渠道与任务状态使用，保存内容不保证是完整原始请求。
- **顶部导航**：在站点设置中配置自定义导航链接、显示方式与排序。
- **充值提示**：在支付方式配置中设置提示文字、链接、图片与显示开关，为不同支付方式提供对应说明。
- **飞书告警**：在上游成本监控设置中配置机器人 Webhook 与签名密钥，使用测试通知检查配置，再关注倍率变化与成本异常。

<a id="fork-faq"></a>

## 常见问题

| 问题 | 检查项 |
| --- | --- |
| 部署后看不到分支功能 | 确认检出的分支和提交，检查 Compose 是否仍指向上游官方镜像，重新构建并更新容器 |
| 默认分支没有按请求成本选项 | 固定 `USD/request` 模式仅在 `feat/upstream-request-cost`；确认构建分支与运行镜像 |
| 发票申请无法提交 | 检查抬头、税号、可选充值订单与退款扣减后的净额；当前净额须大于 500 |
| 邀请用户消费后没有佣金 | 检查推广佣金开关、比例及邀请关系；只有钱包余额消费计佣，订阅额度消耗不计佣 |
| 大陆网页过滤没有生效 | 确认开关、允许分组，以及源站收到的国家码是否为 `CN` |
| 模型 API 仍可调用 | 这是预期行为；网页地区可见性不限制 API 调用 |
| 使用日志没有上游成本 | 检查消费日志开关、全局监控、渠道监控模式与成本参数；新配置不会自动补齐所有历史成本 |
| 自动模式显示未知 | 检查上游是否兼容、接口是否可访问、密钥权限与主节点运行情况；查看渠道详情中的错误信息 |
| 毛利统计与账单不一致 | 检查估算状态、覆盖率、时间范围、保留期，以及上游折算配置；按请求成本不会随退款自动调整 |

分支相关问题请在[本仓库 Issues](https://github.com/atelier-of-dongn/YMeng-CC-New-API/issues)中反馈，附上部署提交、复现步骤与脱敏日志。下方官方文档、发行版和社区链接属于上游 New API，未必涵盖本分支的定制功能。

<a id="upstream-reference"></a>

## 上游参考

以下保留上游 New API 的功能介绍、部署示例、相关项目、许可与致谢。**其中克隆上游仓库、拉取官方镜像或应用商店安装的命令，仅适用于上游版本。部署本分支请使用上面的分支部署流程。**

<div align="center">

## 上游项目入口

<p align="center">
  <a href="https://raw.githubusercontent.com/Calcium-Ion/new-api/main/LICENSE">
    <img src="https://img.shields.io/github/license/Calcium-Ion/new-api?color=brightgreen" alt="license">
  </a><!--
  --><a href="https://github.com/Calcium-Ion/new-api/releases/latest">
    <img src="https://img.shields.io/github/v/release/Calcium-Ion/new-api?color=brightgreen&include_prereleases" alt="release">
  </a><!--
  --><a href="https://hub.docker.com/r/CalciumIon/new-api">
    <img src="https://img.shields.io/badge/docker-dockerHub-blue" alt="docker">
  </a>
  <a href="https://atomgit.com/QuantumNous/new-api" target="_blank">
    <img alt="AtomGit G-Star" src="https://atomgit.com/QuantumNous/new-api/star/badge.svg"/>
  </a>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/20180" target="_blank">
    <img src="https://trendshift.io/api/badge/repositories/20180" alt="QuantumNous%2Fnew-api | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/>
  </a>
  <br>
  <a href="https://hellogithub.com/repository/QuantumNous/new-api" target="_blank">
    <img src="https://api.hellogithub.com/v1/widgets/recommend.svg?rid=539ac4217e69431684ad4a0bab768811&claim_uid=tbFPfKIDHpc4TzR" alt="Featured｜HelloGitHub" style="width: 250px; height: 54px;" width="250" height="54" />
  </a><!--
  -->
  <a href="https://atomgit.com/QuantumNous/new-api" target="_blank">
    <img alt="AtomGit G-Star" src="https://atomgit.com/QuantumNous/new-api/star/new_badge.svg" width="250" height="55" />
  </a>
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-key-features">Key Features</a> •
  <a href="#-deployment">Deployment</a> •
  <a href="#-documentation">Documentation</a> •
  <a href="#-help-support">Help</a>
</p>

</div>

## 📝 Project Description

> [!IMPORTANT]
> - This project is intended solely for lawful and authorized AI API gateway, organization-level authentication, multi-model management, usage analytics, cost accounting, and private deployment scenarios.
> - Users must lawfully obtain upstream API keys, accounts, model services, and interface permissions, and must comply with upstream terms of service and applicable laws and regulations.
> - Users should ensure their use complies with upstream terms of service and applicable laws and regulations.
> - When providing generative AI services to the public, users should comply with applicable regulatory requirements and fulfill all filing, licensing, content safety, real-name verification, log retention, tax, and upstream authorization obligations required by their jurisdiction.

---

## 🤝 Trusted Partners

<p align="center">
  <em>No particular order</em>
</p>

<p align="center">
  <a href="https://www.cherry-ai.com/" target="_blank">
    <img src="./docs/images/cherry-studio.png" alt="Cherry Studio" height="80" />
  </a><!--
  --><a href="https://github.com/iOfficeAI/AionUi/" target="_blank">
    <img src="./docs/images/aionui.png" alt="Aion UI" height="80" />
  </a><!--
  --><a href="https://bda.pku.edu.cn/" target="_blank">
    <img src="./docs/images/pku.png" alt="Peking University" height="80" />
  </a><!--
  --><a href="https://www.compshare.cn/?ytag=GPU_yy_gh_newapi" target="_blank">
    <img src="./docs/images/ucloud.png" alt="UCloud" height="80" />
  </a><!--
  --><a href="https://www.aliyun.com/" target="_blank">
    <img src="./docs/images/aliyun.png" alt="Alibaba Cloud" height="80" />
  </a><!--
  --><a href="https://io.net/" target="_blank">
    <img src="./docs/images/io-net.png" alt="IO.NET" height="80" />
  </a>
</p>

---

## 🙏 Special Thanks

<p align="center">
  <a href="https://www.jetbrains.com/?from=new-api" target="_blank">
    <img src="https://resources.jetbrains.com/storage/products/company/brand/logos/jb_beam.png" alt="JetBrains Logo" width="120" />
  </a>
</p>

<p align="center">
  <strong>Thanks to <a href="https://www.jetbrains.com/?from=new-api">JetBrains</a> for providing free open-source development license for this project</strong>
</p>

---

## 🚀 Quick Start

### Using Docker Compose (Recommended)

```bash
# Clone the project
git clone https://github.com/QuantumNous/new-api.git
cd new-api

# Edit docker-compose.yml configuration
nano docker-compose.yml

# Start the service
docker-compose up -d
```

<details>
<summary><strong>Using Docker Commands</strong></summary>

```bash
# Pull the latest image
docker pull calciumion/new-api:latest

# Using SQLite (default)
docker run --name new-api -d --restart always \
  -p 3000:3000 \
  -e TZ=Asia/Shanghai \
  -v ./data:/data \
  calciumion/new-api:latest

# Using MySQL
docker run --name new-api -d --restart always \
  -p 3000:3000 \
  -e SQL_DSN="root:123456@tcp(localhost:3306)/oneapi" \
  -e TZ=Asia/Shanghai \
  -v ./data:/data \
  calciumion/new-api:latest
```

> **💡 Tip:** `-v ./data:/data` will save data in the `data` folder of the current directory, you can also change it to an absolute path like `-v /your/custom/path:/data`

</details>

---

🎉 After deployment is complete, visit `http://localhost:3000` to start using!

> [!WARNING]
> When operating this project as a public generative AI service or API resale service, users should first complete all required filing, licensing, content safety, real-name verification, log retention, tax, payment, and upstream authorization obligations.

📖 For more deployment methods, please refer to [Deployment Guide](https://docs.newapi.pro/en/docs/installation)

---

## 📚 Documentation

<div align="center">

### 📖 [Official Documentation](https://docs.newapi.pro/en/docs) | [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/QuantumNous/new-api)

</div>

**Quick Navigation:**

| Category | Link |
|------|------|
| 🚀 Deployment Guide | [Installation Documentation](https://docs.newapi.pro/en/docs/installation) |
| ⚙️ Environment Configuration | [Environment Variables](https://docs.newapi.pro/en/docs/installation/config-maintenance/environment-variables) |
| 📡 API Documentation | [API Documentation](https://docs.newapi.pro/en/docs/api) |
| ❓ FAQ | [FAQ](https://docs.newapi.pro/en/docs/support/faq) |
| 💬 Community Interaction | [Communication Channels](https://docs.newapi.pro/en/docs/support/community-interaction) |

---

## ✨ Key Features

> For detailed features, please refer to [Features Introduction](https://docs.newapi.pro/en/docs/guide/wiki/basic-concepts/features-introduction)

### 🎨 Core Functions

| Feature | Description |
|------|------|
| 🎨 New UI | Modern user interface design |
| 🌍 Multi-language | Supports Simplified Chinese, Traditional Chinese, English, French, Japanese |
| 🔄 Data Compatibility | Fully compatible with the original One API database |
| 📈 Data Dashboard | Visual console and statistical analysis |
| 🔒 Permission Management | Token grouping, model restrictions, user management |

### 💰 Authorized Usage Accounting and Billing

- ✅ Internal top-up and quota allocation for lawful authorized scenarios (EPay, Stripe)
- ✅ Organization-level per-request, usage-based, and cache-hit cost accounting
- ✅ Cache billing statistics for OpenAI, Azure, DeepSeek, Claude, Qwen, and supported models
- ✅ Flexible billing policies for internal management or authorized enterprise customers

### 🔐 Authorization and Security

- 😈 Discord authorization login
- 🤖 LinuxDO authorization login
- 📱 Telegram authorization login
- 🔑 OIDC unified authentication
- 🔍 Key quota query usage (with [new-api-key-tool](https://github.com/Calcium-Ion/new-api-key-tool))

### 🚀 Advanced Features

**API Format Support:**
- ⚡ [OpenAI Responses](https://docs.newapi.pro/en/docs/api/ai-model/chat/openai/create-response)
- ⚡ [OpenAI Realtime API](https://docs.newapi.pro/en/docs/api/ai-model/realtime/create-realtime-session) (including Azure)
- ⚡ [Claude Messages](https://docs.newapi.pro/en/docs/api/ai-model/chat/create-message)
- ⚡ [Google Gemini](https://doc.newapi.pro/en/api/google-gemini-chat)
- 🔄 [Rerank Models](https://docs.newapi.pro/en/docs/api/ai-model/rerank/create-rerank) (Cohere, Jina)

**Intelligent Routing:**
- ⚖️ Channel weighted random
- 🔄 Automatic retry on failure
- 🚦 User-level model rate limiting

**Format Conversion:**
- 🔄 **OpenAI Compatible ⇄ Claude Messages**
- 🔄 **OpenAI Compatible → Google Gemini**
- 🔄 **Google Gemini → OpenAI Compatible** - Text only, function calling not supported yet
- 🚧 **OpenAI Compatible ⇄ OpenAI Responses** - In development
- 🔄 **Thinking-to-content functionality**

**Reasoning Effort Support:**

<details>
<summary>View detailed configuration</summary>

**OpenAI series models:**
- `o3-mini-high` - High reasoning effort
- `o3-mini-medium` - Medium reasoning effort
- `o3-mini-low` - Low reasoning effort
- `gpt-5-high` - High reasoning effort
- `gpt-5-medium` - Medium reasoning effort
- `gpt-5-low` - Low reasoning effort

**Claude thinking models:**
- `claude-3-7-sonnet-20250219-thinking` - Enable thinking mode

**Google Gemini series models:**
- `gemini-2.5-flash-thinking` - Enable thinking mode
- `gemini-2.5-flash-nothinking` - Disable thinking mode
- `gemini-2.5-pro-thinking` - Enable thinking mode
- `gemini-2.5-pro-thinking-128` - Enable thinking mode with thinking budget of 128 tokens
- You can also append `-low`, `-medium`, or `-high` to any Gemini model name to request the corresponding reasoning effort (no extra thinking-budget suffix needed).

</details>

---

## 🤖 Model Support

> For details, please refer to [API Documentation - Gateway Interface](https://docs.newapi.pro/en/docs/api)

| Model Type | Description | Documentation |
|---------|------|------|
| 🤖 OpenAI-Compatible | OpenAI compatible models | [Documentation](https://docs.newapi.pro/en/docs/api/ai-model/chat/openai/createchatcompletion) |
| 🤖 OpenAI Responses | OpenAI Responses format | [Documentation](https://docs.newapi.pro/en/docs/api/ai-model/chat/openai/createresponse) |
| 🎨 Midjourney-Proxy | [Midjourney-Proxy(Plus)](https://github.com/novicezk/midjourney-proxy) | [Documentation](https://doc.newapi.pro/api/midjourney-proxy-image) |
| 🎵 Suno-API | [Suno API](https://github.com/Suno-API/Suno-API) | [Documentation](https://doc.newapi.pro/api/suno-music) |
| 🔄 Rerank | Cohere, Jina | [Documentation](https://docs.newapi.pro/en/docs/api/ai-model/rerank/creatererank) |
| 💬 Claude | Messages format | [Documentation](https://docs.newapi.pro/en/docs/api/ai-model/chat/createmessage) |
| 🌐 Gemini | Google Gemini format | [Documentation](https://docs.newapi.pro/en/docs/api/ai-model/chat/gemini/geminirelayv1beta) |
| 🔧 Dify | ChatFlow mode | - |
| 🎯 Custom upstream | Supports configuring legally authorized upstream endpoints | - |

### 📡 Supported Interfaces

<details>
<summary>View complete interface list</summary>

- [Chat Interface (Chat Completions)](https://docs.newapi.pro/en/docs/api/ai-model/chat/openai/createchatcompletion)
- [Response Interface (Responses)](https://docs.newapi.pro/en/docs/api/ai-model/chat/openai/createresponse)
- [Image Interface (Image)](https://docs.newapi.pro/en/docs/api/ai-model/images/openai/post-v1-images-generations)
- [Audio Interface (Audio)](https://docs.newapi.pro/en/docs/api/ai-model/audio/openai/create-transcription)
- [Video Interface (Video)](https://docs.newapi.pro/en/docs/api/ai-model/videos/sora/createvideo)
- [Embedding Interface (Embeddings)](https://docs.newapi.pro/en/docs/api/ai-model/embeddings/createembedding)
- [Rerank Interface (Rerank)](https://docs.newapi.pro/en/docs/api/ai-model/rerank/creatererank)
- [Realtime Conversation (Realtime)](https://docs.newapi.pro/en/docs/api/ai-model/realtime/createrealtimesession)
- [Claude Chat](https://docs.newapi.pro/en/docs/api/ai-model/chat/createmessage)
- [Google Gemini Chat](https://docs.newapi.pro/en/docs/api/ai-model/chat/gemini/geminirelayv1beta)

</details>

---

## 🚢 Deployment

> [!TIP]
> **Latest Docker image:** `calciumion/new-api:latest`

### 📋 Deployment Requirements

| Component | Requirement |
|------|------|
| **Local database** | SQLite (Docker must mount `/data` directory)|
| **Remote database** | MySQL ≥ 5.7.8 or PostgreSQL ≥ 9.6 |
| **Container engine** | Docker / Docker Compose |
| **System architecture** | 64-bit only (amd64 / arm64); 32-bit systems are not supported |

### ⚙️ Environment Variable Configuration

<details>
<summary>Common environment variable configuration</summary>

| Variable Name | Description | Default Value |
|--------|------|--------|
| `SESSION_SECRET` | Authentication signing secret; must be identical on every node | - |
| `SESSION_COOKIE_SECURE` | `false`/unset disables the refresh/logout OriginGuard for local HTTP dev proxies; `true` enables the Secure cookie and strict Origin checks | `false` |
| `SESSION_COOKIE_TRUSTED_URL` | Required with Secure mode: comma-separated exact HTTPS Origins allowed to call refresh/logout; not a relay CORS allowlist | - |
| `TRUSTED_PROXIES` | Unset/blank trusts loopback, RFC 1918 and IPv6 ULA with a startup warning; `none` trusts no proxies; an explicit proxy IP/CIDR list replaces the defaults | `127.0.0.0/8, ::1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7` |
| `USER_SESSION_ACTIVE_LIMIT` | Maximum active login Sessions per user | `50` |
| `USER_SESSION_ISSUANCE_LIMIT` | Maximum Sessions created per user within the issuance window, including revoked Sessions | `100` |
| `USER_SESSION_ISSUANCE_WINDOW_SECONDS` | Per-user Session issuance window; clamped to the revoked retention period when configured higher | `86400` |
| `USER_SESSION_REVOKED_RETENTION_DAYS` | Days to retain revoked Session rows for audit and issuance accounting | `7` |
| `USER_SESSION_HOURLY_ALERT_THRESHOLD` | Global Sessions created per hour that triggers an alert only; it never blocks login | `5000` |
| `CRYPTO_SECRET` | HMAC secret for cache keys; nodes sharing Redis must use the same effective value | Defaults to `SESSION_SECRET` |
| `SQL_DSN` | Database connection string | - |
| `REDIS_CONN_STRING` | Redis connection string | - |
| `RELAY_IDLE_CONN_TIMEOUT` | Idle keep-alive timeout for relay HTTP clients, seconds. Defaults to Go standard library behavior; set `0` to disable | `90` |
| `RELAY_RESPONSE_HEADER_TIMEOUT` | How long the relay waits for upstream **response headers**, seconds; set `0` to disable. Only bounds the header wait -- streaming after the headers arrive is unaffected. Note that non-streaming upstreams usually send headers only once generation finishes, so leave headroom | `1800` |
| `STREAMING_TIMEOUT` | Streaming timeout (seconds) | `300` |
| `STREAM_SCANNER_MAX_BUFFER_MB` | Max per-line buffer (MB) for the stream scanner; increase when upstream sends huge image/base64 payloads | `64` |
| `MAX_REQUEST_BODY_MB` | Max request body size (MB, counted **after decompression**; prevents huge requests/zip bombs from exhausting memory). Exceeding it returns `413` | `32` |
| `AZURE_DEFAULT_API_VERSION` | Azure API version | `2025-04-01-preview` |
| `ERROR_LOG_ENABLED` | Error log switch | `false` |
| `PYROSCOPE_URL` | Pyroscope server address | - |
| `PYROSCOPE_APP_NAME` | Pyroscope application name | `new-api` |
| `PYROSCOPE_BASIC_AUTH_USER` | Pyroscope basic auth user | - |
| `PYROSCOPE_BASIC_AUTH_PASSWORD` | Pyroscope basic auth password | - |
| `PYROSCOPE_MUTEX_RATE` | Pyroscope mutex sampling rate | `5` |
| `PYROSCOPE_BLOCK_RATE` | Pyroscope block sampling rate | `5` |
| `HOSTNAME` | Hostname tag for Pyroscope | `new-api` |

📖 **Complete configuration:** [Environment Variables Documentation](https://docs.newapi.pro/en/docs/installation/config-maintenance/environment-variables)

</details>

### 🔧 Deployment Methods

<details>
<summary><strong>Method 1: Docker Compose (Recommended)</strong></summary>

```bash
# Clone the project
git clone https://github.com/QuantumNous/new-api.git
cd new-api

# Edit configuration
nano docker-compose.yml

# Start service
docker-compose up -d
```

</details>

<details>
<summary><strong>Method 2: Docker Commands</strong></summary>

**Using SQLite:**
```bash
docker run --name new-api -d --restart always \
  -p 3000:3000 \
  -e TZ=Asia/Shanghai \
  -v ./data:/data \
  calciumion/new-api:latest
```

**Using MySQL:**
```bash
docker run --name new-api -d --restart always \
  -p 3000:3000 \
  -e SQL_DSN="root:123456@tcp(localhost:3306)/oneapi" \
  -e TZ=Asia/Shanghai \
  -v ./data:/data \
  calciumion/new-api:latest
```

> **💡 Path explanation:**
> - `./data:/data` - Relative path, data saved in the data folder of the current directory
> - You can also use absolute path, e.g.: `/your/custom/path:/data`

</details>

<details>
<summary><strong>Method 3: BaoTa Panel</strong></summary>

1. Install BaoTa Panel (≥ 9.2.0 version)
2. Search for **New-API** in the application store
3. One-click installation

📖 [Tutorial with images](./docs/installation/BT.md)

</details>

### ⚠️ Multi-machine Deployment Considerations

> [!WARNING]
> - All nodes must use the same primary database and the same `SESSION_SECRET`; otherwise Access Tokens, refresh sessions, and temporary authentication flows cannot be verified consistently.
> - Nodes connected to the same Redis must also use the same `CRYPTO_SECRET`, or their cache-key digests will differ and shared entries cannot be reused consistently.

The database is authoritative for login Sessions and for the per-user active/issuance limits. Redis Session entries are short-lived caches whose TTL follows `SYNC_FREQUENCY` (60 seconds by default) and never exceeds the Session's remaining lifetime.

| Redis topology | Session propagation | Rate limiting |
| --- | --- | --- |
| Shared Redis | Revocations and version publications normally propagate immediately | Redis limits are shared across nodes |
| Independent Redis per node | Nodes converge from the database within the effective `SYNC_FREQUENCY`; a newly rotated token may receive a temporary 401 on a node with stale cache | Each node has its own allowance, so aggregate capacity can reach roughly the configured limit multiplied by the node count |
| No Redis | Every Session validation reads the database | In-memory limits are independent per node |

A shorter `SYNC_FREQUENCY` reduces the independent-Redis staleness window but causes one additional primary-key Session lookup per active SID, per node, per TTL. These guarantees make Session authentication bounded-stale across the supported topologies; rate limits and other Redis-backed control-plane caches remain topology-dependent.

See [User authentication and login sessions](./docs/authentication.md) for the token, Origin-check and PAT contracts.

### 🔄 Channel Retry and Cache

**Retry configuration:** `Settings → Operation Settings → General Settings → Failure Retry Count`

**Cache configuration:**
- `REDIS_CONN_STRING`: Redis cache (recommended)
- `MEMORY_CACHE_ENABLED`: Memory cache

---

## 🔗 Related Projects

### Upstream Projects

| Project | Description |
|------|------|
| [One API](https://github.com/songquanpeng/one-api) | Original project base |
| [Midjourney-Proxy](https://github.com/novicezk/midjourney-proxy) | Midjourney interface support |

### Supporting Tools

| Project | Description |
|------|------|
| [new-api-key-tool](https://github.com/Calcium-Ion/new-api-key-tool) | Key quota query tool |
| [new-api-horizon](https://github.com/Calcium-Ion/new-api-horizon) | New API high-performance optimized version |

---

## 💬 Help Support

### 📖 Documentation Resources

| Resource | Link |
|------|------|
| 📘 FAQ | [FAQ](https://docs.newapi.pro/en/docs/support/faq) |
| 💬 Community Interaction | [Communication Channels](https://docs.newapi.pro/en/docs/support/community-interaction) |
| 🐛 Issue Feedback | [Issue Feedback](https://docs.newapi.pro/en/docs/support/feedback-issues) |
| 📚 Complete Documentation | [Official Documentation](https://docs.newapi.pro/en/docs) |

### 🤝 Contribution Guide

Welcome all forms of contribution!

- 🐛 Report Bugs
- 💡 Propose New Features
- 📝 Improve Documentation
- 🔧 Submit Code

---

## 📜 License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPLv3)](./LICENSE).

Additional terms under AGPLv3 Section 7 apply. Modified versions must preserve
the author attribution notice `Frontend design and development by New API
contributors.` in the appropriate legal notices and in any prominent about,
legal, footer, or attribution location presented by the user interface.

Modified versions that present a user interface must also preserve a visible
link to the original project: <https://github.com/QuantumNous/new-api>.

This is an open-source project developed based on [One API](https://github.com/songquanpeng/one-api) (MIT License).

If your organization's policies do not permit the use of AGPLv3-licensed software, or if you wish to avoid the open-source obligations of AGPLv3, please contact us at: [support@quantumnous.com](mailto:support@quantumnous.com)

---

## 🌟 Star History

<div align="center">

[![Star History Chart](https://api.star-history.com/svg?repos=Calcium-Ion/new-api&type=Date)](https://star-history.com/#Calcium-Ion/new-api&Date)

</div>

---

<div align="center">

### 💖 Thank you for using New API

If this project is helpful to you, welcome to give us a ⭐️ Star！

**[Official Documentation](https://docs.newapi.pro/en/docs)** • **[Issue Feedback](https://github.com/Calcium-Ion/new-api/issues)** • **[Latest Release](https://github.com/Calcium-Ion/new-api/releases)**

<sub>Built with ❤️ by QuantumNous</sub>

</div>
