# Ultreia Development Runbook

这份文档保存低频但必须准确的开发、部署和数据库操作细节。`AGENTS.md` / `CLAUDE.md` 只保留常驻规则；执行 Android 发版、Edge Function 部署、原生配置或 Supabase schema 工作前，必须先读这里的对应章节。

## Android 发版流程

```
git tag v0.2.0 && git push origin v0.2.0
```

→ `.github/workflows/release.yml` 自动跑：装 Node 22 / JDK 21 / Android SDK → `npm ci` → `npm run build` → `cap sync` → 用 Secrets 里的 keystore 签 release APK → 建 GitHub Release + 挂 APK。约 2-3 分钟。`versionCode` 自动用 `GITHUB_RUN_NUMBER`，`versionName` 自动从 tag 取（去掉 `v` 前缀）。

**bump 版本号** 同步改 `package.json` 的 `version`（APP 内"检查更新"按钮显示的本地版本号来自这里），保持跟 tag 一致。

**Release 更新说明** 由 `.github/workflows/release.yml` 从 `docs/changelog.md` 抽取自上一个 tag 以来新增的具体 bullet 写入 GitHub Release，并同步写入 Supabase Storage 的 `releases/ultreia-latest.json` manifest；不要再用 commit 标题生成更新内容。tag 前必须确认 changelog 已有本次用户能感知的具体条目，否则 release workflow 会失败。

**更新检查 / APK 镜像**：release workflow 会上传 `releases/ultreia-vX.Y.Z.apk`（版本号镜像，供新版 App 优先下载）、`releases/ultreia-latest.apk`（旧版兼容兜底）和 `releases/ultreia-latest.json`（新版 App 优先读取的轻量更新 manifest）。如果用户反馈检查更新失败或下载很慢，先测 manifest、versioned APK mirror、legacy latest APK mirror，再测 GitHub Releases API / asset。

**用户 shorthand**：Wilf 说「推 apk」= 按本节标准流程发 Android APK；Wilf 说「推 0111」这类数字 = 版本号，按去掉点解析（例如 `0111` → `0.11.1`、`0110` → `0.11.0`），然后 bump 到该版本、提交、打对应 `v*` tag 并推送触发 GitHub Actions。若数字无法唯一切分版本号，再停下来确认。

**推完即交付**：APK 发版只需要确认版本号 commit、`v*` tag 和 tag push 成功；GitHub Actions / Release 构建不用在当前对话里等到完成，Wilf 会自行更新检查。

**tag 前 Android 原生检查**：推 APK / tag 前除了常规 `npm run test`、`npm run lint`、`npm run build`，还要跑一次 Android release 配置检查，至少覆盖 manifest 合并：`cd android && bash ./gradlew :app:processReleaseMainManifest --no-daemon`。如果本机缺 Java / Android SDK 跑不了，要在交付里明确说明未本地验证，并在推 tag 后用 `gh run view --log-failed` 跟进失败原因，不能只说 bump 成功。

**GitHub Actions 查询兜底**：如果本机 `gh run list/view` 报 TLS / x509 证书错误，这只说明本机 GitHub CLI 证书链不可用，不代表 APK workflow 没触发；先用 `git ls-remote --tags origin vX.Y.Z` 确认 tag 已在远端，再通过 GitHub 网页或公开 API 核对 `Release Android APK`，并在交付里明示本机无法用 `gh` 跟进。

**版本号规则（pre-1.0，`0.MINOR.PATCH`，只增不跳号）**：每个 tag = 一次发版，判据只有一条——这次 tag 里**有没有用户能感知的新功能**。

- **PATCH +1**（`0.7.0 → 0.7.1`）：bug 修复、样式 / 文案微调、性能优化、随代码改的文档——**不含**新的用户可感知功能。
- **MINOR +1**（`0.7.x → 0.8.0`，PATCH 归零）：新增 / 显著改动一个用户可感知功能，或一批值得对用户「宣布」的更新（feature batch）。
- **MAJOR**（`→ 1.0.0`）：产品达到可正式公开发布的稳定度时才动；在那之前一直 `0.x`。
- 不「凭感觉跳号」。例如 `0.6.20` 之后：只修 bug → `0.6.21`；这次的训练负荷 / 复盘这类功能批 → `0.7.0`。

### 必要的 GitHub Secrets

| Secret | 用途 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | 签名 keystore 的 base64 编码 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 文件密码 |
| `ANDROID_KEY_ALIAS` | keystore 内 key 的 alias（以 GitHub Secret 当前值为准；新建证书建议用 `ultreia`）|
| `ANDROID_KEY_PASSWORD` | key 密码（跟 store 密码一致）|
| `VITE_SUPABASE_URL` | build 时注入前端；缺了 APP 启动白屏 |
| `VITE_SUPABASE_ANON_KEY` | 同上 |
| `VITE_AMAP_JSAPI_KEY` | 可选；启用位置选择器里的高德 JSAPI 地图 |
| `VITE_AMAP_SECURITY_JS_CODE` | 可选；高德 JSAPI 安全密钥，和上面的 key 一起配置 |
| `VITE_AMAP_SERVICE_HOST` | 可选；如果后续用代理保护高德安全密钥，用这个服务地址替代前端 security code |

keystore 文件如需本地放置，建议用 `android/app/ultreia-release.jks`（gitignored），passwords 永远不进 repo。

## Edge Functions 部署（每日推送 / 收件箱）

推送链路在 Supabase Edge Functions 里。**前端发版（push main / tag）不会带上它们**——改了 `supabase/functions/*` 的代码，必须单独手动部署：

```
cd <项目根>
npx supabase login                                    # 一次性；token 存 Windows 凭据管理器
npx supabase link --project-ref ihibmkfgfznqwzavaeiq   # 一次性；状态存 supabase/.temp/（已 gitignore）
npx supabase functions deploy daily-coach-dispatch --no-verify-jwt
```

- **`--no-verify-jwt` 看函数加不加**：靠登录用户 JWT 鉴权的（`coach-proxy` / `weather-proxy` / `delete-account`）部署时**不要**加；不靠用户 JWT 的（`daily-coach-dispatch` 由 pg_cron 定时调用、靠 header `x-cron-secret` 鉴权；`register-with-invite` 注册前调用、还没 JWT）**必须加** `--no-verify-jwt`，否则被网关挡掉。
- 本机没装 supabase CLI / scoop，用 `npx supabase` 即可（首次自动下载）。部署时 `WARNING: Docker is not running` 可忽略（远程部署不需要 Docker）。
- 函数：
  - `daily-coach-dispatch`（pg_cron 定时生成每日 AI 打卡、后台周报和夜间 Memory 审核 → FCM 推送 / 写 `push_inbox`；部署加 `--no-verify-jwt`；AI provider 优先 desktop Codex runner，失败回退 DeepSeek；个人模式不扣钱包）
  - `agent-report-dispatch`（独立 shadow Reporter；每 30 分钟 Cron，约本地 00:30 计算 14 日计划偏差候选，其余 tick 只重试；写 `agent_report_outbox` 并以 HMAC 投递 Aevum ingress；不调用 LLM、不推通知、不写训练数据；部署加 `--no-verify-jwt`）
  - `coach-proxy`（AI Coach 代理；优先把 `coach_chat` / `weekly_report` / `memory_update` / `plan_extract` / `plan_deviation_rescue` 等任务派给 desktop Codex runner，失败回退 DeepSeek；个人模式不检查钱包余额、不扣钱包）
  - `weather-proxy`（彩云天气代理；`mode=bundle` 实时+7天预报算一次天气请求，`mode=single` 单端点；个人模式不检查钱包余额、不扣钱包）
  - `wallet-status`（旧公开模式钱包状态；当前个人模式不主动调用）
  - `payment-notify-admin`（用户扫码付款后提交充值提醒 → 写管理员 `push_inbox` / FCM；不自动加余额）
  - `admin-wallet-grant`（管理员核对收款后给用户钱包加余额，并给用户写充值完成提醒）
  - `register-with-invite`（邀请码注册，公共注册关闭；service_role 校验一次性邀请码 → 建 auth 用户 → 烧码；部署加 `--no-verify-jwt`）
  - `delete-account`（自助注销整个 Aevum 账号；校验当前登录用户后删除 auth 用户，依赖各产品表的外键 cascade 清理 Aevum / Ultreia / Viatica / Sidera 个人数据）
  - `push-test`（早期冒烟测试，可退役）

**Edge Function Secrets**（Supabase Dashboard → Edge Functions → Secrets，**不进 git**）：`FCM_SERVICE_ACCOUNT`（service-account JSON）、`CRON_SECRET`（须与 pg_cron SQL 里发的一致）、`SHARED_DEEPSEEK_KEY`（服务端 DeepSeek key）、`SHARED_CAIYUN_TOKEN`（服务端彩云 token）、`AEVUM_ULTREIA_USER_ID`（唯一启用的 Wilf auth UUID）、`AEVUM_ULTREIA_REPORT_HMAC_SECRET`（Ultreia → Aevum 独立 HMAC secret）。`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 平台自动注入。

## 历史教训（避免重蹈）

- **PWA service worker 必须在 Capacitor WebView 里跳过**：SW 拦截 app-asset scheme fetch → 白屏。`src/main.jsx` 已做 `isNativePlatform` 检测，native 上不注册并 unregister 旧 SW。
- **Rolldown 1.0.0 linux-x64 tree-shaking 过激**：CI vite build 砍掉一半 app 代码。`vite.config.js` 里 `build.rolldownOptions.treeshake = false` 关掉，bundle 大 ~400KB 但正确。upstream 修了再考虑打开。
- **`.env.local` 不进 git 但 CI 要它的值**：所有 `VITE_*` 变量需要在 GitHub Secrets 里也存一份，workflow build step 用 `env:` 注入。
- **Android Studio 装在 F 盘**：`F:\Android Studio\jbr\bin\keytool.exe`；SDK 在 `%LOCALAPPDATA%\Android\Sdk`；`ANDROID_HOME` 已设。新机器要重新设。
- **移动端全局 `button { min-height: 40px }`（`src/index.css`）会撑大小按钮**：开关、徽章这类本该很小的 `<button>` 在手机上被强行撑到 40px 高（为了点击热区）。做小控件时在按钮上显式写 `minHeight: 0`（或具体高度）覆盖。坑过：每日推送开关、PR 卡的 ITRA 小标。
- **`@supabase/supabase-js` 用新版 `sb_publishable_…` key 当 `VITE_SUPABASE_ANON_KEY`**：是 anon key 的现行替代，浏览器安全、配合 RLS。**绝不要**把 `sb_secret_…`（service_role）放进前端 / `.env.local`——它绕过 RLS，只能在 Edge Function 里用。
- **天气列 `workouts.weather` 是 jsonb**：往里塞嵌套结构（如长训练的 `series` 数组）不需要改表。

## Supabase 数据层约定

业务数据全部在 Supabase。schema 变更**必须由用户在 Supabase Dashboard 执行 SQL**，Claude 没法替代。涉及以下情况时，**必须主动提醒**并附上完整 SQL：

- 新增字段（`ALTER TABLE … ADD COLUMN …`）
- 改字段类型 / 重命名 / 删字段
- 新增 / 修改 CHECK 约束
- 新增 / 修改 RLS policy
- 新建表 / 加触发器

提醒格式（在动手前停下来报告）：

```
⚠ 这个改动需要 Supabase schema 变更，请在 Dashboard 的 SQL Editor 跑：

ALTER TABLE races ADD COLUMN subtype TEXT;

跑完告诉我，再继续前端改造。
```

DAL 层（`src/lib/db/*.js`）的 FIELD_MAP / fromRow / toRow 跟着改时也要明示哪个文件加了哪个字段映射，方便用户校对。

不要静默改 DAL 假设数据库已经同步——前端跑通 + 数据库列缺失 = 静默写入失败或 NULL 漂移，后果难定位。

## Supabase 表清单

- `profiles` — 一行一用户，主键 `id = auth.uid()`
- `user_settings` — 一行一用户，外键 `user_id`
- `workouts` — 训练记录
- `races` — 赛事（target + history 共表，`is_target` 区分）
- `coach_messages` — AI Coach 对话历史，append-only
- `coach_reports` — AI 周复盘报告
- `coach_report_notes` — 周复盘相关备注 / 交互记录
- `coach_memory_facts` — AI Coach 长期记忆事实卡
- `agent_actions` — AI Coach Action Card 生命周期记录
- `agent_report_outbox` — Ultreia → Aevum shadow Report 的单行水位、pending envelope、退避与租约；仅 service-role
- `training_locations` — 训练地点 / 天气位置
- `daily_notes` — 每日笔记 / 打卡
- `push_subscriptions` — 设备推送订阅（FCM token）
- `push_getui_devices` — 个推设备绑定
- `push_inbox` — 推送收件箱（每日打卡等推送落库）
- `push_log` — 推送 / 后台任务去重日志
- `ai_jobs` — desktop runner / AI 后台任务队列
- `ai_runners` — runner 在线状态登记，不是单用户数据

共享 desktop Codex runner 的代码和运行说明由 Aevum 管理，macOS 路径为
`/Users/danxiao/Projects/Aevum/tools/desktop-codex-runner`。Ultreia 继续负责
AI Coach 的任务创建、DeepSeek fallback 和结果落库；Sidera 通过同一
`ai_jobs` 队列与 `company-mac-mini-codex` runner id 使用该 runner。
- `invite_codes` — 一次性邀请码（注册用，service_role 烧码）
- `wallets` — 旧公开模式钱包余额（人民币分）；当前个人模式 AI / 天气不依赖
- `wallet_ledger` — 旧公开模式钱包流水（AI / 天气 / 充值 / 退款等）；当前个人模式 AI / 天气不写入
- `app_admins` — 管理员账号白名单（旧钱包充值、邀请码等）
- `usage_quota` — 旧免费额度表，仅保留删除账号兼容；新扣费逻辑不要继续依赖它
- `viatica_accounts` / `viatica_budgets` / `viatica_preferences` / `viatica_transactions` — 同一 Aevum Supabase project 下的 Viatica 表；账号删除时通过 `user_id → auth.users(id) ON DELETE CASCADE` 清理
- `sidera_entries` / `sidera_nodes` / `sidera_links` / `sidera_reviews` / `sidera_messages` / `sidera_agent_actions` / `sidera_preferences` — 同一 Aevum Supabase project 下的 Sidera 表；AI 建议先落为待确认 action，不静默写入长期知识库
- `aevum_standing_policies` / `aevum_agent_reports` / `aevum_derived_memories` / `aevum_derived_memory_sources` / `aevum_cross_product_actions` / `aevum_agent_journal_entries` — Aevum Phase A 自治控制面基础表；已建立但当前为空，客户端权限锁定，不代表 Ultreia 已接通运行时
- `aevum_agent_context_memories` — Aevum Phase A 派生记忆上下文视图；当前仅供未来可信服务端路径读取

公共字段约定：`id uuid PK`、用户归属表用 `user_id uuid → auth.users(id) ON DELETE CASCADE`、`created_at timestamptz`、`updated_at timestamptz`（如有）。RLS 全部按 `auth.uid() = user_id` 过滤；非用户归属的系统表需单独说明边界。
