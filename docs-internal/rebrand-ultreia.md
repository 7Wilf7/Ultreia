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

### 1. 域名切换（2026-06-12 完成 ✅）

- [x] **Vercel** → Domains 已加 `ultreia.run`（308 → www）和 `www.ultreia.run`（Production）
- [x] **阿里云解析**：`@` A → `216.198.79.1`；`www` CNAME → `bfdeced61aabd1b0.vercel-dns-017.com`
- [x] 双双 Valid Configuration，浏览器已验证 https://ultreia.run 打开 app
- **旧域名策略（重要）**：`aitrainstudio.com` 继续绑定同一项目正常服务，**不做 redirect、
  不下线**——已发布的老版本 APK 里天气代理（`WEATHER_PROXY_ORIGIN`）和登录跳转还
  硬编码指向它，redirect 可能干扰 POST 代理请求。等绝大多数用户升级到新版后再考虑跳转。

### 2. 代码里的功能性 URL 切换（2026-06-12 完成 ✅）

- [x] `src/hooks/useAuth.js` — `AUTH_REDIRECT_TO` → https://www.ultreia.run/
- [x] `src/lib/weather.js` — `WEATHER_PROXY_ORIGIN` → https://www.ultreia.run
- [x] `src/components/Auth/LoginScreen.jsx` — 登录页「访问网页版」链接
- [x] `src/components/MonthlyPosterModal.jsx` — 海报底部网址 → www.ultreia.run
- [x] `supabase/functions/register-with-invite/index.ts` — emailRedirectTo
- [x] `scripts/seed-demo.mjs` — 打印的登录链接；**demo 邮箱 `demo@aitrainstudio.com`
      故意不改**（它是 Supabase 里已存在账号的标识，改了脚本会另建孤儿账号）
- [x] **Supabase Dashboard** → Authentication → URL Configuration：
      Site URL → `https://www.ultreia.run`；Redirect URLs 已含
      `https://www.ultreia.run/**`、`https://ultreia.run/**`（旧域名条目保留）✅ 2026-06-12

### 3. Edge Function 部署（2026-06-12 完成 ✅）

- [x] `daily-coach-dispatch` 已部署（推送标题 → Ultreia）
- [x] `register-with-invite` 已部署（注册邮件跳新域名）

### 4. Logo 重设计（用户正在打磨）

- 方向已定：保留深色背景 + 等高线纹理 + 米白山脊线，新增 **Ultreïa 的 ï 两个点**
  做成山脊上方的两颗星（典：Compostela 一说源自 campus stellae「星野」，
  朝圣者沿银河指引而行）。
- **2026-06-12 迭代结论**：v1 提示词从零生成效果不满意；GPT 出过一张接近满意的图
  （桌面 `ChatGPT Image Jun 12, 2026, 07_39_06 AM.png`）：等高线清晰、山保持断笔
  形态、右下角有黄色小横杠。用户拍板——等高线就要那张图的清晰度；山保持断笔
  （**不要**一笔连续）；两个点放**右侧山峰正上方**；小横杠位置大小照旧但改**深苔绿**
  （不要黄色）。
- **首选玩法：拿那张图喂给 GPT 做定向修改**（从零生成构图会漂移），提示词 v2：

  ```
  Use the attached app icon as the exact base. Keep EVERYTHING about it unchanged —
  the dark charcoal background, the clearly visible topographic contour lines, the
  cream broken-stroke mountain ridgeline with its gaps, the squircle shape, the
  composition. Make ONLY two precise changes:

  1. Recolor the small horizontal dash near the base of the right slope from
     yellow-gold to a muted deep moss green (#8A8B5C). Same size, same position.

  2. Add two small round dots in the same warm cream color as the mountain strokes,
     floating directly above the apex of the RIGHT (smaller) peak, side by side,
     like two stars in the night sky. Each dot's diameter ≈ the stroke width of the
     ridgeline. Keep a clear gap between the dots and the peak — they must read as
     floating stars (a subtle nod to the diaeresis of "Ultreïa"), not as part of
     the mountain. The contour lines should pass behind them undisturbed.

  Do not redraw, restyle, or "improve" anything else. Flat matte finish, no gloss,
  no gradients on the mark.
  ```

- 备用（从零生成）提示词 v2：

  ```
  Minimalist flat vector app icon, rounded square (squircle). Background: very dark
  warm charcoal (#1B1A17) covered edge-to-edge with CLEARLY VISIBLE thin topographic
  contour lines in a slightly lighter charcoal grey — dense, organic, hand-drawn
  quality, like a real trail map at night. The contours are a key visual feature,
  not a faint texture.

  Centerpiece: a mountain ridgeline of two peaks (left peak taller) drawn in warm
  off-white cream strokes with deliberate BROKEN-STROKE construction — the strokes
  are separate angular segments with small intentional gaps where they meet, like
  confident brush lifts, NOT one continuous outline. Uniform stroke width, crisp
  flat edges.

  Directly above the apex of the right peak: two small cream round dots side by
  side, floating like two stars (a nod to the diaeresis of "Ultreïa"), each dot
  about as wide as the ridgeline stroke, clearly separated from the peak.

  One small muted deep moss green (#8A8B5C) horizontal dash near the base of the
  right slope — the only color accent.

  Flat 2D, matte, no gloss, no gradients, no text, no shadows, premium outdoor-brand
  minimalism. Mark fills ~55% of the canvas, centered.
  ```

  微调话术：点太大 `make the dots 20% smaller`；离山太近 `raise the dots slightly`；
  间距 `the gap between the two dots equals one dot's width`。
  可选追加（带字标）：`Below the mark, the wordmark "ULTREÏA" in a clean geometric
  sans-serif, letterspaced, cream color`；让山上两颗星给字标的 ï 当点：
  `the two dots above the ridge align vertically with the letter i in the wordmark,
  acting as its diaeresis`。

- 定稿后的落地步骤（一次换齐，不然开屏和应用内会出现两个不同 logo）：
  - [x] 原图母版存 `resources/brand/ultreia-original.png`，轻量运行时图存 `resources/ultreia-logo.webp`，更新 `src/assets/logo.js` 的 import
  - [x] 替换 `public/favicon.jpg`（PWA/桌面图标）
  - [x] 替换 `resources/splash-logo.png` 并跑 `node scripts/make-splash.mjs` 重新生成原生开屏
  - [x] Android launcher icon（`android/app/src/main/res/mipmap-*`）用 `node scripts/make-adaptive-foreground.mjs` 重新生成

### 5. 其他

- [ ] 中国商标网（http://wcjs.sbj.cnipa.gov.cn/）查「Ultreia」第 9 / 41 / 42 类（用户自查）
- [ ] 发版：改名属于用户可感知的显著变化，下次 tag 建议 **0.10.0**
- [ ] （可选，以后再说）GitHub repo 改名 training-studio → ultreia：GitHub 会自动
      301 旧地址，但 CLAUDE.md / AGENTS.md / UpdateChecker 里的 Releases API URL、
      Vercel 的 repo 绑定要跟着检查
