# Training Studio

Wilf's Training Studio —— 从 Claude.ai artifact 搬过来的 React 单页应用。

## 技术栈
- Vite 8 + React 19 (JSX, 非 TypeScript)
- 包管理: npm (PowerShell 下用 `npm.cmd`，因执行策略不允许 `.ps1`)

## 目录约定
- `src/App.jsx` —— 主组件入口
- `src/components/` —— 拆分出来的子组件
- `src/data/` —— 静态数据 (题库、配置、JSON)
- `src/styles/` —— CSS / Tailwind 配置 (如使用)
- `public/` —— 静态资源 (图片、字体)
- `docs/` —— 用户向英文文档（GitBook 格式，见下方约定）
- 暂不引入路由，单页面即可；如后续需要再加 react-router

## docs/ 维护纪律

`docs/` 下是给最终用户看的英文功能文档（GitBook 风格，`SUMMARY.md` 是 TOC）。**任何功能变化或新增都要同步改这里**，文档落后于代码比没有文档更糟。

现有文件：

- `docs/README.md` —— 应用整体介绍
- `docs/training-log.md` —— 训练记录（Run / Strength / HIIT）
- `docs/running.md` —— 跑步分类 + 心率自动分类规则
- `docs/data-import.md` —— Garmin CSV 导入
- `docs/races.md` —— 赛事 + PR bar
- `docs/ai-coach.md` —— AI Coach 全流程
- `docs/charts.md` —— 图表
- `docs/SUMMARY.md` —— GitBook 目录
- `docs/changelog.md` —— 版本变更

触发更新的场景（举例，不限于这些）：

- 新增 / 删除一个 activity type、subtype、race category
- 改 `autoClassifyRun` 的心率阈值或分类规则
- 改 AI Coach 的 prompt 拼装、数据块选取规则、token 上限
- 改 Garmin CSV 的字段映射或新加列
- 改 PR 排序逻辑
- 新增 / 修改图表

每次重要功能变更**同步在 `docs/changelog.md` 加一条**（日期 + 改了什么）。

## 常用命令
- `npm.cmd run dev` —— 启动开发服务器 (默认 http://localhost:5173)
- `npm.cmd run build` —— 生产构建 (输出到 dist/)
- `npm.cmd run preview` —— 本地预览构建产物
- `npm.cmd run lint` —— ESLint 检查

## 工作流约定
- 改完代码主动跑 `npm.cmd run dev` 验证，能跑起来再交付
- 大改动前先在小样本上验证，参考全局 CLAUDE.md 中的工作纪律
- 不引入额外构建工具或框架除非明确需要 (例如 Next.js、Remix)
- 新依赖安装前先告知用途和体积影响

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

## Supabase 表清单（截至 3.3 接入完成）

- `profiles` — 一行一用户，主键 `id = auth.uid()`
- `user_settings` — 一行一用户，外键 `user_id`
- `workouts` — 训练记录
- `races` — 赛事（target + history 共表，`is_target` 区分）
- `coach_messages` — AI Coach 对话历史，append-only

公共字段约定：`id uuid PK`、`user_id uuid → auth.users(id)`、`created_at timestamptz`、`updated_at timestamptz`（如有）。RLS 全部按 `auth.uid() = user_id` 过滤。
