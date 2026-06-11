# Rebrand：Training Studio → Ultreia

> 交接文档。2026-06-12 在家里电脑定名并完成第一批改名；剩余事项在下方 checklist，
> 任何一台电脑 pull 下来照着做即可无缝继续。完成一项就把 `[ ]` 勾成 `[x]`。

## 名字的由来（定稿记录）

- **Ultreia**（写法变体 Ultreïa / Ultreya），读 **/ul-TREY-a/**「乌尔特雷亚」。
- 中世纪圣地亚哥朝圣之路（Camino de Santiago）上朝圣者相遇时互道的口号，
  拉丁语**「向更远处去！」**（对方回应 *et suseia*——「向更高处去」）。
- 跟产品的契合点：耐力运动的精神内核（更远、更高）、山系 logo（朝圣即翻山越岭）、
  AI 教练每日鼓励（一句喊了一千年的加油口号）。
- **查重结论（2026-06-12 查）**：Google Play 无同名跑步/健身/训练 app；
  现存使用者为 ultreia.me（志愿者做的朝圣徒步指南 PWA）、Ultreïa（Steam 解谜游戏）、
  Ultreia Comunicaciones（西班牙 IT 公司），均不构成同品类冲突。
  ultreia.com 被私人持有（近空页面）。
- 此前候选 **Chaski** 被否：美国有 Chaski Endurance Collective（教练团队）+
  Google Play 已有 CHASKi.fit（耐力运动 app），同品类正面撞车。

## 域名

- **`ultreia.run` 已注册**（阿里云，2026-06-11，到期 2027-06）。
- 旧域名 `aitrainstudio.com` 在切换完成后**至少保留一个续费周期**做跳转，
  海报/外发链接里都印过它。

## 不变的东西（红线）

- **`applicationId` / namespace：`com.aitrainstudio.app` 永久不改**——改了 Android
  视为全新 app，老用户「检查更新」永远收不到新版。包名用户不可见，留着无害。
- GitHub repo 名 `training-studio`、`package.json` 的 `name` 字段暂不改（纯内部标识，
  改不改不影响用户；想改另起一次提交）。
- Supabase 项目、所有表、Edge Functions 名字不动。
- `custom_url_scheme` / `package_name`（strings.xml）不动。

## 已完成（2026-06-12，本次提交）

应用内所有用户可见的「Training Studio」→「Ultreia」：

- `index.html`（title + apple-mobile-web-app-title）
- `vite.config.js` PWA manifest（name / short_name）
- `capacitor.config.json` appName
- `android/.../values/strings.xml`（app_name / title_activity_main）
- `src/i18n/translations.js`（header.title、header.title_empty、display_name_hint、poster.monthly_note）
  - 中文标题方案：`{name} 的 Ultreia`（品牌名不翻译，同 Strava 用法）——文案可再打磨
- `src/App.jsx`（logo alt ×2、备份导出 payload 的 `app` 字段——该字段无导入校验，安全）
- `src/components/Auth/LoginScreen.jsx`（logo alt）
- `src/components/MonthlyPosterModal.jsx`（海报手写签名、分享标题）
- `src/components/OnboardingTour.jsx`（AI Coach 介绍文案）
- `src/data/tutorials.js`（彩云 app 建议名 trainingstudio → ultreia）
- `src/data/posterFonts.js` / `src/index.css`（注释）
- `scripts/make-splash.mjs`（TEXT → 'Ultreia'）+ 重新生成的原生开屏 PNG
- `android` 两个插件（下载通知标题、相册文件夹 Pictures/Ultreia）
- `.github/workflows/release.yml`（bundle 冒烟检查字符串、Release 标题）
- `supabase/functions/daily-coach-dispatch/index.ts`（推送标题）——**改了代码但还没部署**，见下
- 文档：docs/README、SUMMARY、charts、data-import、changelog（新条目）、PRODUCT.md、
  CLAUDE.md、AGENTS.md、项目结构导览.html

## 待办 checklist

### 1. 域名切换（需要在两个控制台手动操作）

- [ ] **Vercel** → 项目 Settings → Domains → Add `ultreia.run` 和 `www.ultreia.run`；
      Vercel 会显示需要的 DNS 记录值
- [ ] **阿里云** → 域名控制台 → ultreia.run → 解析设置：
      按 Vercel 给的值加记录（典型：`@` A 记录 → `76.76.21.21`；
      `www` CNAME → `cname.vercel-dns.com`；以 Vercel 页面显示为准）
- [ ] 等解析生效，浏览器验证 https://ultreia.run 能打开 app
- [ ] 旧域名在 Vercel 里保留并设置 redirect → ultreia.run（Vercel Domains 页可直接配）

### 2. 代码里的功能性 URL 切换（⚠ 必须等第 1 步生效后再做）

- [ ] `src/hooks/useAuth.js:5` — `AUTH_REDIRECT_TO`
- [ ] `src/lib/weather.js:15` — `WEATHER_PROXY_ORIGIN`
- [ ] `src/components/Auth/LoginScreen.jsx:613` — 登录页「访问网页版」链接
- [ ] `src/components/MonthlyPosterModal.jsx:566` — 海报底部网址（用户可见，跟品牌强相关）
- [ ] `supabase/functions/register-with-invite/index.ts:102` — emailRedirectTo（改完要重新部署该函数，**加 --no-verify-jwt**）
- [ ] `scripts/seed-demo.mjs` — demo 邮箱域名 + 提示链接（低优先级）
- [ ] **Supabase Dashboard** → Authentication → URL Configuration：把 ultreia.run 加进
      Site URL / Redirect URLs 白名单（不加的话邮件验证/重置密码会跳回旧域名或被拒）

### 3. Edge Function 部署（推送标题已改码未部署）

- [ ] `npx supabase functions deploy daily-coach-dispatch --no-verify-jwt`
      （部署后每日打卡推送的标题变成「Ultreia」）

### 4. Logo 重设计（用户正在打磨）

- 方向已定：保留深色背景 + 等高线纹理 + 米白山脊线，新增 **Ultreïa 的 ï 两个点**
  做成山脊上方的两颗星（典：Compostela 一说源自 campus stellae「星野」，
  朝圣者沿银河指引而行）。
- 给图像模型的提示词（定稿版，可直接复制）：

  ```
  Minimalist flat vector app icon, rounded square (squircle). Background: very dark warm
  charcoal, almost black (#1B1A17), overlaid with extremely subtle tone-on-tone topographic
  contour lines, barely visible, matte texture, no gloss.

  Centerpiece: a clean geometric mountain ridgeline drawn as a single continuous angular
  stroke in warm off-white / cream (#EDE8DC) — two asymmetric peaks, the left peak taller,
  sharp angular folds, modern and abstract, like a stylized letter M formed by a mountain
  ridge. Uniform stroke width, crisp edges.

  Above the ridgeline, slightly right of center: two small round dots in the same cream
  color, floating like two stars in the night sky — a subtle reference to the diaeresis of
  the word "Ultreïa". The dots should be clearly intentional, aligned side by side, sized
  in proportion to the stroke width of the ridge.

  One tiny accent: a short olive-green (#8A8B5C) dash near the base of the right slope,
  as a minimal color signature.

  Style: flat 2D vector, no gradients on the mark itself, no text, no shadows, no 3D,
  generous negative space, premium outdoor-brand aesthetic (think COROS / Arc'teryx
  minimalism). Composition centered, icon fills ~60% of the canvas.
  ```

  可选追加：带字标版本 `Below the mark, the wordmark "ULTREÏA" in a clean geometric
  sans-serif, letterspaced, cream color`；让山上两颗星给字标的 ï 当点用：
  `the two dots above the ridge align vertically with the letter i in the wordmark,
  acting as its diaeresis`。

- 定稿后的落地步骤（一次换齐，不然开屏和应用内会出现两个不同 logo）：
  - [ ] 新图存 `resources/`，更新 `src/assets/logo.js` 的 import
  - [ ] 替换 `public/favicon.jpg`（PWA/桌面图标）
  - [ ] 替换 `resources/splash-logo.png` 并跑 `node scripts/make-splash.mjs` 重新生成原生开屏
  - [ ] Android launcher icon（`android/app/src/main/res/mipmap-*`）用 capacitor-assets 或手动替换

### 5. 其他

- [ ] 中国商标网（http://wcjs.sbj.cnipa.gov.cn/）查「Ultreia」第 9 / 41 / 42 类（用户自查）
- [ ] 发版：改名属于用户可感知的显著变化，下次 tag 建议 **0.10.0**
- [ ] （可选，以后再说）GitHub repo 改名 training-studio → ultreia：GitHub 会自动
      301 旧地址，但 CLAUDE.md / AGENTS.md / UpdateChecker 里的 Releases API URL、
      Vercel 的 repo 绑定要跟着检查
