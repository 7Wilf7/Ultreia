# 赛事管理

Races tab 管两件相关的事：你**计划参加**的未来赛事，和你**已经跑过**的历史赛事。它们共用一张表和同一个表单，靠 `is_target` 字段区分。顶部的 Personal Records bar 自动从历史里聚合每个类别的最佳成绩。

## 赛事类别

七个固定类别，按显示顺序排列：

1. **10K**
2. **Half Marathon（半马）**
3. **Marathon（全马）**
4. **Trail（越野）** —— 距离不定，有爬升字段
5. **Spartan（斯巴达）** —— 按 tier 分（Sprint / Super / Beast / Ultra），按难度排序
6. **Hyrox** —— 固定室内赛制，无距离/爬升字段
7. **Other** —— 兜底类别

这个顺序同时决定了表单下拉框和 PR bar 的展示顺序。

## 目标赛事（`is_target = true`）

按**日期升序**排（最近的下一场在最前）。每条包含：

- **Priority（优先级）** —— A / B / C。A = "决定整个赛季的核心赛"，B = 次要，C = 参与性质。优先级会影响 PR bar 颜色，发给 AI 教练时会拼成 "Priority A/B/C"，让教练知道哪场最重要。
- **类别** + （仅 Spartan）tier
- **日期**
- **距离 / 爬升** —— Trail 和 Other 有；路跑类（10K/HM/M）距离已由类别决定所以隐藏；Hyrox 也隐藏
- **名称**

### 添加目标

1. Races tab → **Add Target Race**。
2. **先选类别** —— 表单会根据类别动态显示/隐藏字段。
3. 填名称、日期、优先级，按需要填距离/爬升。
4. 如果日期在过去，会弹警告问要不要直接归到 History。

## 历史赛事（`is_target = false`）

按**日期降序**排（最近的最前）。表单跟目标一样，多一个**完赛时间**字段（H:M:S）。Trail 历史还能在 PR bar 上挂一个可选的 **ITRA Performance Index** badge。

## 筛选

目标和历史各有一行类别筛选 chips。多选 —— 点几个就筛几个，点 **All** 清空。section 标题旁的计数器在有筛选时会显示 `已筛 / 总数`。

## Personal Records bar

放在 Races tab 顶部，从历史列表里自动聚合每类的 PR：

- **10K / Half Marathon / Marathon / Hyrox / Other** —— 按**最快完赛时间**排。
- **Trail** —— 按**最长距离**排（越野「PR」更看重的是耐力而非速度）。
- **Spartan** —— 按**最难 tier** 排（Ultra > Beast > Super > Sprint）。

每张 PR 卡片下面的「+ other finishes」可以展开看这一类的其他成绩。

### ITRA

Trail 那张 PR 卡的右上角有一个 **ITRA** 小 badge。点它录入或更新你的全局 ITRA 表现指数。这是**每个用户一个值**（不是每场赛事一个）—— 历史赛事行上保留的 per-race ITRA 字段是为了兼容旧数据，不再从赛事表单编辑。

## 编辑 / 删除

点任一行进内联编辑模式。没分类的行上有个小下拉框，直接设类别不用打开完整表单。最右边的 × 删除（带确认）。

## 注意

- 目标赛事**全量**发给 AI 教练；历史是**筛选过**的 —— 每类最近 3 条，再加 Trail 最长距离一条 + Spartan 最难 tier 一条作为锚点。详情见 [AI 教练](ai-coach.md)。
- PR bar 用 CSS Grid `auto-fit` 自动换行，竖向分隔线是每个 cell 的 `border-left`，不依赖 modulo 计数，所以无论一行排几个卡片都有竖线。
- Spartan tier 存在 `subtype` 字段（跟 Run 子类共用同一列），PR bar 通过 `SPARTAN_RANK` 映射读取难度顺序。
