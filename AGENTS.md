# Ultreia

**Ultreia** 是 Aevum 家族里严肃、数据优先的耐力训练产品。

## 技术栈
- Vite 8 + React 19 (JSX, 非 TypeScript)
- 包管理: npm (PowerShell 下用 `npm.cmd`，因执行策略不允许 `.ps1`)

## 部署 & 分发

- **Web 版**：Vercel，主域名 `https://ultreia.run/`；`www` 仅 308 跳转。品牌迁移见 `docs-internal/rebrand-ultreia.md`
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
- **放在 Aevum**：全局 Today、Quick Add、Products 入口、跨产品 Report / Query / Action 契约、standing policy、派生记忆生命周期、异常队列和全局 Agent 路由。
- **交界需求**：Ultreia 可主动上报隐私裁剪后的训练 Report，也可回答窄范围只读 Query；Aevum 只把已通过长期权限规则或人工异常审核、仍有效且训练相关的上下文交给 Ultreia。改变训练数据的 Action 必须回到 Ultreia 做最新状态、权限、风险和冲突检查。
- **不要把 Ultreia 扩成超级 App**：全局入口、跨产品编排、统一策略和全局派生记忆优先放 Aevum；Ultreia 只做训练域内最小接入。
- 如果归属不确定，先按“是否直接改变训练体验”判断：直接改变训练记录、计划、教练建议或赛事准备 = Ultreia；只是让多个产品协同或统一入口 = Aevum。

## Aevum 账号体系与删除账号

账号统一叫 **Aevum 账号 / Aevum account**。Aevum、Ultreia、Viatica、Sidera 都是同一个 Aevum 账号下的产品模块；登录、注册、Settings、账号页、删除账号、充值备注等面向用户的文案不要写成 “Ultreia 账号 / Ultreia account”。

“删除账号”在 Ultreia 内的含义必须始终是：**删除整个 Aevum 账号**。UI 文案必须明确说明这会删除 Aevum / Ultreia / Viatica / Sidera 下的所有个人数据，不能让用户误解成只是退出 Ultreia、只删除 Ultreia 数据，或只清空训练记录。

不要把“只删除 Ultreia 数据但保留 Viatica 数据”的逻辑塞进“删除账号”。如果未来需要单产品清空能力，应单独命名为“清空 Ultreia 数据”或“重置训练数据”，并放在训练数据管理语义下，不要混用账号删除。

技术实现上，Aevum 账号删除以删除 `auth.users` 为全局入口，由各产品用户表的 `user_id references auth.users(id) on delete cascade` 负责清理。Ultreia 的 `delete-account` Edge Function 只校验当前登录用户并删除 auth 用户，不再手动维护产品表清理清单。新增用户归属表时，必须先确保外键 cascade 覆盖，再把表投入生产；不要在删号函数里补产品专属逐表删除逻辑。

## Agent 化推进

Ultreia 已从 **AI Coach Copilot** 推进到有 Action Card、Action Log、Memory facts 和结果评估的训练域 Agent。当前 source of truth 是 `docs-internal/agentization-roadmap.md`，背景分析见 `docs-internal/agentization-analysis.md`。

推进原则：

- Action Card 是结构化动作信封和审计记录，不天然等于人工审批卡。当前 UI 仍以确认式动作运行；目标权限模式分为 `auto` / `guarded` / `requires_user`。
- Wilf 审批长期权限和风险边界，不审批每一条 Agent 内部消息。授权范围内、低风险、可逆的动作可在最新状态和冲突守卫通过后自动执行；增加训练负荷、修改主课或目标赛、健康风险和无法消解的冲突仍需用户。
- 不做黑箱自动改计划。所有自动动作都要说明原因、保留基线和执行结果、幂等，并尽量支持撤销或补偿。
- 每推进一个 agent 化能力，都要同步更新 `docs-internal/agentization-roadmap.md` 的状态、范围和下一步；如果实施中发现某项不必要、不准确或风险过高，直接修改或删除 roadmap 中对应内容，不保留过期设想。
- 面向最终用户的可见行为变化，同步更新 `docs/` 使用手册和 `docs/changelog.md`；仅内部规划变化只更新 `docs-internal/`。
- 每次推进 agent 化或调整 agent 化 roadmap，也同步更新 Obsidian 备忘。先按 Aevum `docs/ecosystem/REPO_PATHS.md` 解析 vault；当前 Windows 路径是 `C:\Users\wilf7\dev\Wilf's 2nd Brain\Ultreia\...`，macOS 候选是 `/Users/danxiao/Desktop/Wilf's 2nd Brain/ultreia/...`。项目边界、Aevum / Ultreia 归属、长期方向或 source of truth 变化同步更新 `项目.md`；工作流程 / 收尾清单变化同步更新 `工作流程.md`。Obsidian 是长期备忘，不替代 repo 内 source of truth。

## 运维与发布

Android 发版、GitHub Secrets、Edge Function 部署、工程红线和数据库操作的完整步骤见 `docs-internal/development-runbook.md`。执行这些任务前必须先读对应章节。

- 只有用户明确说“推 APK / 发 APK / bump / tag”时才发 Android；数字 shorthand 按 `0111 → 0.11.1` 解析，无法唯一切分时再确认。
- tag 前除常规测试外必须运行 Android release manifest 检查；具体命令和失败兜底见 runbook。
- 修改 `supabase/functions/*` 后必须单独部署，普通 push / tag 不会自动部署 Edge Functions。
- 密码、token、私钥、keystore 和 service-role key 永远不进仓库。

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
- **需求路由预检**：每个新需求执行前先判断归属 Aevum 还是 Ultreia；直接改变训练体验的放 Ultreia，跨产品入口、policy、全局派生记忆和 Report / Query / Action 路由放 Aevum。涉及生态边界时先读 Aevum `docs/ecosystem/`。
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

业务数据全部在 Supabase。新增或修改列、约束、RLS、表、外键、触发器前，必须先给用户完整 SQL，由用户在 Dashboard 执行并确认；确认前不要修改前端或 DAL 假设 schema 已同步。确认后同步调整 `src/lib/db/*.js` 的字段映射，并明确说明改了什么。

完整操作流程、公共字段约定和当前表清单见 `docs-internal/development-runbook.md`。
