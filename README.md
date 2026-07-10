# Ultreia

Ultreia 是 Aevum 家族里的耐力训练产品：训练记录、日历计划、赛事管理、AI Coach、天气、周复盘和账号设置集中在同一个 React/Vite 单页应用里。

正式 Web 入口：<https://ultreia.run/>

## 产品家族

- **Aevum**：全局入口、跨产品事件、记忆审核、权限和未来全局 Agent。
- **Ultreia**：训练记录、赛事、恢复、天气与训练关系、AI Coach 和训练域 Agent 动作。
- **Viatica**：记账、预算、账本同步、导入导出和财务数据边界。
- **Sidera**：学习、捕捉、反思、深度研究、知识星图和 Sidera Agent。

跨产品信息只通过 Aevum 审核后的事件和记忆进入 Ultreia；Ultreia 不直接读取 Viatica 或 Sidera 的私有数据。

## 常用命令

```bash
npm run dev
npm run test
npm run lint
npm run build
npm run preview
```

## 项目文档

- `AGENTS.md` / `CLAUDE.md`：协作规则、部署流程、Supabase/Edge Function、AI Runner 和 APK 发版约定。
- `PRODUCT.md`：产品定位、边界、家族关系和当前里程碑。
- `DESIGN.md`：Ultreia 的家族设计语言、训练产品视觉原则和组件方向。
- `docs/`：应用内中文使用手册，会被打包进使用指南。
- `docs/changelog.md`：用户可感知更新日志。
- `docs-internal/`：内部产品、迁移、Agent 化和品牌记录。
- `docs-internal/development-runbook.md`：Android 发版、Edge Function、Secrets、工程红线和 Supabase 操作细节。

## 发版提示

Web 版随 `main` 分支推送自动部署到 Vercel，正式入口是 `https://ultreia.run/`。Android APK 只在明确要发版时 bump 版本并推 `vX.Y.Z` tag，由 GitHub Actions 构建 release APK。
