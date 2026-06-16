# Ultreia

Ultreia 是一个面向耐力跑者的个人教练操作台：训练记录、日历计划、赛事管理、AI Coach、天气和钱包扣费集中在同一个 React/Vite 单页应用里。

## 常用命令

- `npm run dev`：本地开发
- `npm run lint`：ESLint 检查
- `npm run build`：生产构建
- `npm run preview`：本地预览构建产物

## 项目文档

- `AGENTS.md` / `CLAUDE.md`：协作规则、部署流程、Supabase/Edge Function 约定
- `docs/`：应用内用户手册，会被打包进使用指南
- `docs/changelog.md`：用户可感知更新日志
- `docs-internal/`：内部产品与迁移记录

## 发版提示

Web 版随 `main` 分支推送自动部署到 Vercel。Android APK 只在明确要发版时 bump 版本并推 `vX.Y.Z` tag，由 GitHub Actions 构建 release APK。
