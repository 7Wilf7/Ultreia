# 图表

Charts 子视图（Training tab → **Charts**）按可调时间窗口渲染三张图。所有图都受 Training tab 顶部的 **Global Filter** 影响。

## 时间窗口

图表上方 5 个 preset：

- 最近 **4 周** / 最近 **8 周**
- 最近 **6 个月** / 最近 **12 个月**
- 最近 **5 年**

选一个 preset 同时改**所有三张图**的窗口。窗口永远以「现在」结尾 —— 没有自定义范围（自定义在 Activities 视图的周期选择器，不在 Charts）。

## 1. 跑步距离趋势

折线图，按桶汇总**跑步距离（km）**，桶大小随 preset 是周/月/年。「跑步」指 `RUN_GROUP_TYPES` 里的任一个 —— Road Run、Trail Run、Hiking、Floor Climbing。Strength 和 HIIT 不进，因为没有意义的距离。

- 周桶按周一→周日（ISO 风格），标签形如 `5-18~24` 或跨月 `5-30~6-5`。
- 月桶按自然月。
- 年桶按自然年。
- 线条下方的填充色纯装饰 —— 「等高线」视觉风格。

## 2. 路跑类型分布

水平条形图，按当前窗口内 Road Run 的时间分布到 4 个配速子类（Easy / Aerobic / Tempo / Interval）。

**按时长（秒）加权**，不是按次数。理由：一次 90 分钟 tempo 的训练负荷大于 3 次 20 分钟轻松跑，按时长加权更能反映强度分配。

Trail Run / Hiking / Floor Climbing 不进这个图 —— 它们没配速子类。Strength 和 HIIT 也不进。

## 3. 心率区间分布

按你**个人 Karvonen 区间**（Z1–Z5）的时间分布。

**前置条件**：Profile 里必须填 Resting HR + Max HR + 选一种心率区间方法（Karvonen 严格分法 或 Standard 5-Zone）。没填的话卡片显示「请去 Profile 设置心率区间」的提示。

**近似处理**：训练记录只存每次的平均心率（Garmin CSV 不带 time-in-zone 数据）。每次训练的**完整时长**会被整个塞进它平均心率所属的那个 zone。对混合强度的训练（比如带热身+冷身的间歇课），这种处理会**低估**区间的多样性，但是基于现有数据能做到的最合理近似。

如果非零，下方还会显示两个补充行：

- **Below Z1** —— 平均心率低于你 Z1 下限的训练（热身、超低强度恢复）。
- **Above Z5** —— 平均心率超过你 Z5 上限的训练（罕见）。

## 注意

- 所有三张图都读 `filteredAllLogs`（过滤过的训练集），所以 Training tab 上切 Global Filter chips 时图会立即重渲染。
- 距离趋势图用**本地时间**的日期组件 —— 用 `toISOString()` 会按时区偏移把日期推走（GMT+8 用户的 5 月 21 日会变成 UTC 5 月 20 日），导致桶分配差一天。`CalendarTab.dateKey` 里有同样的坑。
- 路跑类型条形色从 ink（Easy）→ moss（Interval）渐变，呼应强度递增；心率区间条形从 moss-light（Z1）→ ink-1（Z5）。
- 没有 time-in-zone 集成；要集成 Garmin 的每秒 HR 采样得切回 `.fit` 解析，那个功能已经移除。
