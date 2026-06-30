# Ultreia

**Ultreia** —— 从 Claude.ai artifact 搬过来的 React 单页应用。2026-06-12 起产品更名为 Ultreia（中世纪朝圣者口号「向更远处去」，读 /ˈul-TREY-a/）；GitHub repo 已改为 `7Wilf7/Ultreia`，Android `applicationId` 已改为 `run.ultreia.app`，Firebase 项目已改为 `ultreia-ce3d9`。

## 技术栈
- Vite 8 + React 19 (JSX, 非 TypeScript)
- 包管理: npm (PowerShell 下用 `npm.cmd`，因执行策略不允许 `.ps1`)

## 部署 & 分发

- **Web 版**：部署在 Vercel，主域名 `https://www.ultreia.run/`（2026-06-12 切换完成，裸域 308 → www）；旧域名已允许下线；rebrand 全记录见 `docs-internal/rebrand-ultreia.md`
- **GitHub repo**：`https://github.com/7Wilf7/Ultreia`（**public**；main 分支推送后 Vercel 自动构建）
- **PWA**：已通过 vite-plugin-pwa 配置（`autoUpdate` 模式，前端发版后用户重开即拿新版）
- **Android APK**：用 Capacitor 打包，分发走 GitHub Releases；APP 内"检查更新"按钮调 GitHub Releases API 比对版本

不要再向用户询问以上信息——这里就是 source of truth，有变化再回来改这一段。

## 当前产品模式

短期内 Ultreia 是 **个人使用模式**，主要服务 Wilf 自己，不作为公开产品对外开放。实现上以 `src/constants.js` 里的 `PRODUCT_PUBLIC_FEATURES = false` 为开关。

个人模式下应隐藏或收敛这些面向公开用户 / 多用户运营才需要的入口：

- 登录页注册入口、邀请码注册引导
- 邀请码管理入口
- 钱包入口、充值入口、管理员充值入口
- Settings 里的 Wallet / Admin / Other 分组 tab（当前只直接显示每日推送、天气自动更新、语言、使用手册、检查更新等个人设置）

但底层公开模式能力先保留，不要删除：钱包余额与流水、邀请码表、管理员充值、注册相关 Edge Function 都可能在未来公开时恢复入口。当前个人模式下，AI / 天气请求不检查钱包余额，也不会扣钱包；新功能默认不要接入钱包前置判断。如果未来公开模式要恢复钱包，用 `PRODUCT_PUBLIC_FEATURES` 挂起来，并先同步文档和 Supabase schema 方案。

## Aevum 生态与需求路由

Aevum 生态的长期方向、产品边界、跨产品事件、记忆和路径解析，以 Aevum 仓库的生态文档为准：

- Windows: `C:\Users\wilf7\dev\Aevum\docs\ecosystem\README.md`
- macOS: `/Users/danxiao/Projects/Aevum/docs/ecosystem/README.md`

Wilf 在 Windows 和 Mac mini 两台设备上工作。涉及 Aevum、Viatica、Obsidian 或其他产品时，先按生态文档里的 `REPO_PATHS.md` 判断当前设备可用路径；当前路径不存在时，再尝试另一台设备和大小写备选路径。

处理任何新需求前，先判断归属：

- **放在 Ultreia**：训练记录、活动导入、日历训练计划、赛事、PR、天气与训练关系、AI Coach、周复盘、Action Card、运动相关长期记忆、训练海报、Ultreia 内设置和 Android / PWA 发版。
- **放在 Aevum**：全局 Today、Quick Add、Products 入口、跨产品事件中心 `wilf_events`、Memory Inbox、账号 / 全局设置、Viatica / Sidera / Vestigia 等非训练产品、跨产品审核与分发。
- **交界需求**：Aevum 负责收集和审核会影响训练判断的事件；Ultreia 只读取已确认且训练相关的事件，并在 AI Coach 中解释使用。
- **不要把 Ultreia 扩成超级 App**：全局入口、跨产品编排、统一记忆审核优先放 Aevum；Ultreia 只做训练域内最小接入。
- 如果归属不确定，先按“是否直接改变训练体验”判断：直接改变训练记录、计划、教练建议或赛事准备 = Ultreia；只是让多个产品协同或统一入口 = Aevum。

## Aevum 账号体系与删除账号

账号统一叫 **Aevum 账号 / Aevum account**。Ultreia、Viatica、Aevum 都是同一个 Aevum 账号下的产品模块；登录、注册、Settings、账号页、删除账号、充值备注等面向用户的文案不要写成 “Ultreia 账号 / Ultreia account”。

“删除账号”在 Ultreia 内的含义必须始终是：**删除整个 Aevum 账号**。UI 文案必须明确说明这会删除 Aevum / Ultreia / Viatica 下的所有个人数据，不能让用户误解成只是退出 Ultreia、只删除 Ultreia 数据，或只清空训练记录。

不要把“只删除 Ultreia 数据但保留 Viatica 数据”的逻辑塞进“删除账号”。如果未来需要单产品清空能力，应单独命名为“清空 Ultreia 数据”或“重置训练数据”，并放在训练数据管理语义下，不要混用账号删除。

技术实现上，Aevum 账号删除以删除 `auth.users` 为全局入口，由各产品用户表的 `user_id references auth.users(id) on delete cascade` 负责清理。Ultreia 的 `delete-account` Edge Function 只校验当前登录用户并删除 auth 用户，不再手动维护产品表清理清单。新增用户归属表时，必须先确保外键 cascade 覆盖，再把表投入生产；不要在删号函数里补产品专属逐表删除逻辑。

## Agent 化推进

Ultreia 的中期方向是从 **AI Coach Copilot** 逐步推进到 **可确认动作的 AI Coach Agent**。当前 source of truth 是 `docs-internal/agentization-roadmap.md`，背景分析见 `docs-internal/agentization-analysis.md`。

推进原则：

- 先做 **Action Card（建议动作卡片）**，再考虑更自动化的执行；训练计划、健康风险、天气调整这类动作默认需要用户确认。
- 不做黑箱自动改计划。标准流程是：AI 发现问题 → 说明原因 → 提出动作 → 用户确认 / 修改 / 拒绝 → 执行 → 记录结果。
- 每推进一个 agent 化能力，都要同步更新 `docs-internal/agentization-roadmap.md` 的状态、范围和下一步；如果实施中发现某项不必要、不准确或风险过高，直接修改或删除 roadmap 中对应内容，不保留过期设想。
- 面向最终用户的可见行为变化，同步更新 `docs/` 使用手册和 `docs/changelog.md`；仅内部规划变化只更新 `docs-internal/`。
- 每次推进 agent 化或调整 agent 化 roadmap，也同步更新 Obsidian 备忘。Obsidian 候选路径：Windows `C:\Users\wilf7\Desktop\Wilf's 2nd Brain\Ultreia\...`；macOS `/Users/danxiao/Desktop/Wilf's 2nd Brain/ultreia/...`。项目边界、Aevum / Ultreia 归属、长期方向或 source of truth 变化同步更新 `项目.md`；工作流程 / 收尾清单变化同步更新 `工作流程.md`。Obsidian 是长期备忘，不替代 repo 内 source of truth。

### Android 发版流程

```
git tag v0.2.0 && git push origin v0.2.0
```

→ `.github/workflows/release.yml` 自动跑：装 Node 22 / JDK 21 / Android SDK → `npm ci` → `npm run build` → `cap sync` → 用 Secrets 里的 keystore 签 release APK → 建 GitHub Release + 挂 APK。约 2-3 分钟。`versionCode` 自动用 `GITHUB_RUN_NUMBER`，`versionName` 自动从 tag 取（去掉 `v` 前缀）。

**bump 版本号** 同步改 `package.json` 的 `version`（APP 内"检查更新"按钮显示的本地版本号来自这里），保持跟 tag 一致。

**用户 shorthand**：Wilf 说「推 apk」= 按本节标准流程发 Android APK；Wilf 说「推 0111」这类数字 = 版本号，按去掉点解析（例如 `0111` → `0.11.1`、`0110` → `0.11.0`），然后 bump 到该版本、提交、打对应 `v*` tag 并推送触发 GitHub Actions。若数字无法唯一切分版本号，再停下来确认。

**推完即交付**：APK 发版只需要确认版本号 commit、`v*` tag 和 tag push 成功；GitHub Actions / Release 构建不用在当前对话里等到完成，Wilf 会自行更新检查。

**tag 前 Android 原生检查**：推 APK / tag 前除了常规 `npm run test`、`npm run lint`、`npm run build`，还要跑一次 Android release 配置检查，至少覆盖 manifest 合并：`cd android && bash ./gradlew :app:processReleaseMainManifest --no-daemon`。如果本机缺 Java / Android SDK 跑不了，要在交付里明确说明未本地验证，并在推 tag 后用 `gh run view --log-failed` 跟进失败原因，不能只说 bump 成功。

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

### Edge Functions 部署（每日推送 / 收件箱）

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
  - `coach-proxy`（AI Coach 代理；优先把 `coach_chat` / `weekly_report` / `memory_update` / `plan_extract` / `plan_deviation_rescue` 等任务派给 desktop Codex runner，失败回退 DeepSeek；个人模式不检查钱包余额、不扣钱包）
  - `weather-proxy`（彩云天气代理；`mode=bundle` 实时+7天预报算一次天气请求，`mode=single` 单端点；个人模式不检查钱包余额、不扣钱包）
  - `wallet-status`（旧公开模式钱包状态；当前个人模式不主动调用）
  - `payment-notify-admin`（用户扫码付款后提交充值提醒 → 写管理员 `push_inbox` / FCM；不自动加余额）
  - `admin-wallet-grant`（管理员核对收款后给用户钱包加余额，并给用户写充值完成提醒）
  - `register-with-invite`（邀请码注册，公共注册关闭；service_role 校验一次性邀请码 → 建 auth 用户 → 烧码；部署加 `--no-verify-jwt`）
  - `delete-account`（自助注销整个 Aevum 账号；校验当前登录用户后删除 auth 用户，依赖各产品表的外键 cascade 清理 Aevum / Ultreia / Viatica 个人数据）
  - `push-test`（早期冒烟测试，可退役）

**Edge Function Secrets**（Supabase Dashboard → Edge Functions → Secrets，**不进 git**）：`FCM_SERVICE_ACCOUNT`（service-account JSON）、`CRON_SECRET`（须与 pg_cron SQL 里发的一致）、`SHARED_DEEPSEEK_KEY`（服务端 DeepSeek key）、`SHARED_CAIYUN_TOKEN`（服务端彩云 token）。`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 平台自动注入。

### 历史教训（避免重蹈）

- **PWA service worker 必须在 Capacitor WebView 里跳过**：SW 拦截 app-asset scheme fetch → 白屏。`src/main.jsx` 已做 `isNativePlatform` 检测，native 上不注册并 unregister 旧 SW。
- **Rolldown 1.0.0 linux-x64 tree-shaking 过激**：CI vite build 砍掉一半 app 代码。`vite.config.js` 里 `build.rolldownOptions.treeshake = false` 关掉，bundle 大 ~400KB 但正确。upstream 修了再考虑打开。
- **`.env.local` 不进 git 但 CI 要它的值**：所有 `VITE_*` 变量需要在 GitHub Secrets 里也存一份，workflow build step 用 `env:` 注入。
- **Android Studio 装在 F 盘**：`F:\Android Studio\jbr\bin\keytool.exe`；SDK 在 `%LOCALAPPDATA%\Android\Sdk`；`ANDROID_HOME` 已设。新机器要重新设。
- **移动端全局 `button { min-height: 40px }`（`src/index.css`）会撑大小按钮**：开关、徽章这类本该很小的 `<button>` 在手机上被强行撑到 40px 高（为了点击热区）。做小控件时在按钮上显式写 `minHeight: 0`（或具体高度）覆盖。坑过：每日推送开关、PR 卡的 ITRA 小标。
- **`@supabase/supabase-js` 用新版 `sb_publishable_…` key 当 `VITE_SUPABASE_ANON_KEY`**：是 anon key 的现行替代，浏览器安全、配合 RLS。**绝不要**把 `sb_secret_…`（service_role）放进前端 / `.env.local`——它绕过 RLS，只能在 Edge Function 里用。
- **天气列 `workouts.weather` 是 jsonb**：往里塞嵌套结构（如长训练的 `series` 数组）不需要改表。

## 目录约定
- `src/App.jsx` —— 主组件入口
- `src/components/` —— 拆分出来的子组件
- `src/data/` —— 静态数据 (题库、配置、JSON)
- `src/styles/` —— CSS / Tailwind 配置 (如使用)
- `public/` —— 静态资源 (图片、字体)
- `docs/` —— 应用内使用手册的 Markdown 源文件（见下方约定）
- 暂不引入路由，单页面即可；如后续需要再加 react-router

**`项目结构导览.html`（根目录）—— 给非程序员（用户本人）看的可视化文件夹说明，纯介绍每个文件夹的含义。** 新增 / 删除 / 重命名顶层文件夹或目录结构有重大调整时，**必须同步更新这个 HTML**（对应卡片的路径、文件数、说明）。它只解惑用，不写"可删/保留"之类的价值判断。

## docs/ 维护纪律

`docs/` 下是给**最终用户**看的应用内中文使用手册，内容由 `src/components/GuideModal.jsx` 直接打包进 App；`SUMMARY.md` 只作为目录顺序参考，不再以外部 GitBook 为准。用户是中国跑者，**不是程序员**。正文用中文；UI 上能看到的标签和类别名（Road Run / Easy Run / Spartan 等）保留英文。

**红线 —— 不要往里写这些**：

- 技术栈名词（React / Vite / Supabase / RLS / auth.uid() / localStorage…）
- 源文件路径、文件名、行号
- 源码里的函数名 / 常量名 / 字段名（`autoClassifyRun`、`selectHistoryForPrompt`、`RUN_GROUP_TYPES`、`is_target`、`is_planned` 之类）
- 数据库表名、列名
- commit 哈希
- API 内部细节（`system` 字段、`messages` 数组、token 上限、HTTP 状态码…）
- 「源码在 [...](src/...)」之类的链接

**写什么**：

- 在 UI 上怎么操作（按哪个按钮、选哪个 tab、看哪条 chip）
- 每个功能的行为效果（用户能观察到的）
- 用户能调整的开关 / 阈值 / 选项
- 用户能看到的提示和警告

**任何功能变化或新增都要同步改这里**，文档落后于实际功能比没有文档更糟。

现有文件：

- `docs/README.md` —— 应用整体介绍
- `docs/training-log.md` —— 训练记录（Run / Strength / HIIT）
- `docs/running.md` —— 跑步分类 + 心率自动分类规则
- `docs/data-import.md` —— FIT / CSV 导入
- `docs/races.md` —— 赛事 + PR bar
- `docs/ai-coach.md` —— AI Coach 全流程
- `docs/weather.md` —— 天气（实时 / 预报 / 训练快照、24h 窗口、个人模式无钱包扣费）
- `docs/charts.md` —— 图表
- `docs/SUMMARY.md` —— 应用内使用手册目录顺序
- `docs/changelog.md` —— 版本变更

触发更新的场景（举例，不限于这些）：

- 新增 / 删除一个 activity type、subtype、race category
- 改 `autoClassifyRun` 的心率阈值或分类规则
- 改 AI Coach 的 prompt 拼装、数据块选取规则、token 上限
- 改 Garmin CSV 的字段映射或新加列
- 改 PR 排序逻辑
- 新增 / 修改图表

每次重要功能变更**同步在 `docs/changelog.md` 加一条**（日期 + 改了什么）。

**changelog 格式约定**：按日期分组，**一个日期一个 `## YYYY-MM-DD` 标题**——不要周几、不要「批 N」、不要标题后缀（如「—— xxx」）。同一天的多次改动**全部合并**在该日期下，平铺成 bullet 列表即可。

## 常用命令
- `npm.cmd run dev` —— 启动开发服务器 (默认 http://localhost:5173)
- `npm.cmd run build` —— 生产构建 (输出到 dist/)
- `npm.cmd run preview` —— 本地预览构建产物
- `npm.cmd run lint` —— ESLint 检查

## 工作流约定
- **验证 = `npm run test` + `npm run lint` + `npm run build` 通过即可交付**（Windows PowerShell 下用 `npm.cmd run test` / `npm.cmd run lint` / `npm.cmd run build`）。不用再起 dev server / preview 去"看一眼"——app 是邀请制登录，本地起来只有登录页，看不到真实界面（用户也明确说没必要每次起预览检查）。功能对不对由用户在真机/线上验。
- **移动端优先**：用户的需求绝大多数针对手机端；PC 端网页按"跟随移动端"的原则自行优化、保持合理即可，不用每个改动都纠结桌面。用户会不时上 PC 网页看，有问题会反馈。
- **git pull 后汇报更新内容**：每次执行 `git pull` 后，都要根据 pull 输出和必要的 `git log --stat` / `git diff --stat` 简短列出本次拉到的更新内容；如果没有新提交，也要明确说 `Already up to date` / 没有更新。
- **普通改动自动提交推送**：完成代码/文档改动并通过验证后，直接 `git commit` + `git push` 到当前分支，不再单独询问。**Android APK / tag 发版例外**：只有用户明确说“推 APK / 发 APK / bump / tag”时才 bump 版本并推 tag。
- **规则文件同步**：修改本项目协作规则、工作流约定、发版流程或项目记忆时，`AGENTS.md` 和 `CLAUDE.md` 必须同步更新；不要只改其中一个。
- **需求路由预检**：每个新需求执行前先判断归属 Aevum 还是 Ultreia；直接改变训练体验的放 Ultreia，跨产品入口、事件中心和统一记忆审核放 Aevum。涉及生态边界时先读 Aevum `docs/ecosystem/`。
- 大改动前先在小样本上验证，参考全局 CLAUDE.md 中的工作纪律
- 不引入额外构建工具或框架除非明确需要 (例如 Next.js、Remix)
- 新依赖安装前先告知用途和体积影响

### 每次改动收尾清单

- **代码逻辑变化**：跑 `npm run test`、`npm run lint`、`npm run build`。
- **用户可见功能 / 行为变化**：同步更新对应 `docs/*.md` 使用手册，并在 `docs/changelog.md` 当天日期下追加 bullet。
- **AI Coach prompt、Memory、数据块、agent 行为变化**：同步更新 `docs/ai-coach.md`；如果属于 agent 化推进，也更新 `docs-internal/agentization-roadmap.md`。
- **天气行为变化**：同步更新 `docs/weather.md`。
- **导入 / FIT / CSV / ZIP 行为变化**：同步更新 `docs/data-import.md`。
- **训练类型、跑步分类、赛事类别、PR / 图表逻辑变化**：同步更新对应 `docs/training-log.md`、`docs/running.md`、`docs/races.md`、`docs/charts.md`。
- **Android 原生配置变化**（`android/`、Capacitor 插件、Manifest、Gradle、推送 SDK、签名 / 发版 workflow）：除常规验证外，额外跑 `cd android && bash ./gradlew :app:processReleaseMainManifest --no-daemon`；如果改动涉及打包或签名，再跑 `assembleRelease` 或等 GitHub Actions 并检查日志。
- **新增 / 删除 / 重命名顶层文件夹，或目录结构有重大调整**：同步更新根目录 `项目结构导览.html`。
- **协作规则、发版流程、项目 source of truth 变化**：同步更新 `AGENTS.md` 和 `CLAUDE.md`；如果涉及项目边界、Aevum / Ultreia 归属或长期方向，也同步更新 Obsidian 的 Ultreia `项目.md`，路径按本文件上方的 Windows/macOS 候选解析。
- **Supabase schema 变化**：先停下来给用户完整 SQL；用户跑完后再改前端 / DAL，并说明 `src/lib/db/*.js` 哪些字段映射变了。

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
- `training_locations` — 训练地点 / 天气位置
- `daily_notes` — 每日笔记 / 打卡
- `push_subscriptions` — 设备推送订阅（FCM token）
- `push_getui_devices` — 个推设备绑定
- `push_inbox` — 推送收件箱（每日打卡等推送落库）
- `push_log` — 推送 / 后台任务去重日志
- `ai_jobs` — desktop runner / AI 后台任务队列
- `ai_runners` — runner 在线状态登记，不是单用户数据
- `invite_codes` — 一次性邀请码（注册用，service_role 烧码）
- `wallets` — 旧公开模式钱包余额（人民币分）；当前个人模式 AI / 天气不依赖
- `wallet_ledger` — 旧公开模式钱包流水（AI / 天气 / 充值 / 退款等）；当前个人模式 AI / 天气不写入
- `app_admins` — 管理员账号白名单（旧钱包充值、邀请码等）
- `usage_quota` — 旧免费额度表，仅保留删除账号兼容；新扣费逻辑不要继续依赖它
- `viatica_accounts` / `viatica_budgets` / `viatica_preferences` / `viatica_transactions` — 同一 Aevum Supabase project 下的 Viatica 表；账号删除时通过 `user_id → auth.users(id) ON DELETE CASCADE` 清理

公共字段约定：`id uuid PK`、用户归属表用 `user_id uuid → auth.users(id) ON DELETE CASCADE`、`created_at timestamptz`、`updated_at timestamptz`（如有）。RLS 全部按 `auth.uid() = user_id` 过滤；非用户归属的系统表需单独说明边界。
