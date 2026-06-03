# 数据导入（FIT / CSV）

可以上传文件批量/快速导入活动，省去手动录入。支持两种格式：

- **`.fit`** —— 佳明（Garmin）、高驰（Coros）以及绝大多数运动手表**原生导出**的格式，数据最全。一次一个活动。
- **`.csv`** —— 佳明 Connect 网页版的批量导出，一次可导多条。

> **高驰用户注意**：高驰只能导出 `.fit`（没有 CSV 导出），用 `.fit` 上传即可。佳明两种都支持——想一次导很多历史活动用 CSV，想要最全的数据（含心率区间分布、路线）用 `.fit`。

## FIT 比 CSV 多了什么

CSV 只有一次活动的汇总（平均/最大心率、总距离等）。FIT 是手表的原始记录，所以导入 `.fit` 时我们还会额外算出并保存：

- **各心率区间停留时间（Z1–Z5）** —— 图表里的「心率区间时长分布」会用到，AI 教练也能据此判断你的「轻松跑」是不是真的轻松。
- **降采样的 GPS 路线** —— 为后续的成绩分享海报准备（暂不在 app 内画图）。

（CSV / 手动记录的活动没有这两项，不影响其它功能。）

## 从 Garmin Connect 导出 CSV

1. 进 Garmin Connect → **Activities** → 列表视图。
2. 按需要筛选日期或类型（导入器不挑，每行都会让你预览）。
3. 点列表右上角的 **Export CSV** 按钮。
4. 保存到本地。

> 手机也能用这个流程：手机浏览器登录 Garmin Connect 网页版导出 CSV，存到手机，再回到 Training Studio 上传。

## .fit 文件怎么来

- **佳明**：Garmin Connect 网页版打开某次活动 → 右上角齿轮 / ⋯ → **Export Original**（导出的就是 .fit）。手机 App 也能分享/导出原始文件。
- **高驰**：高驰 App 里打开活动 → 分享 / 导出 → 选 **FIT**（或 .fit / 原始文件）。

## 导入流程

1. 打开 Training，进入 Activities 子视图。
2. 点 **Upload**（`.fit / .csv` 都行），选文件。`.fit` 是单次活动，`.csv` 是批量。
3. 可能依次出现两个审核弹窗：
   - **未知活动类型** —— 如果某些行的活动类型识别不了（比如「Open Water Swim」「Padel」），会让你逐条手动选一个对应类型。
   - **重复警告** —— 如果某行的日期/类型/时长跟已有记录完全一致，会让你选 **Skip duplicates（跳过重复）** 或 **Add anyway（强制加入）**。
4. 接着是 **Review** 面板，列出每行的解析结果和勾选框：
   - 不想导入的行取消勾选。
   - Road Run 行可以通过下拉框覆盖自动分配的配速子类。
5. 点 **Import** 写入数据库。

## 读了哪些字段

会从 Garmin CSV 里找以下列：

| Garmin 列名 | 用途 |
|---|---|
| Activity Type | 决定活动类型 |
| Date | 日期 |
| Distance | 距离（km）|
| Time / Total Time / Moving Time / Elapsed Time | 时长（按顺序找第一个存在的列）|
| Avg HR | 平均心率 |
| Max HR | 最大心率 |
| Total Ascent | 累计爬升 |
| Avg Run Cadence | 平均步频 |
| Aerobic TE | 有氧训练效果 |
| Avg GAP | 坡度调整配速 |

配速自动算出来：`时长 ÷ 距离`（两个都 > 0 时）。

## 活动类型怎么映射

读 Garmin 的 "Activity Type" 列，按关键字判断：

| Garmin 类型包含 | 映射到 |
|---|---|
| trail | Trail Run |
| hiking、walking、walk | Hiking |
| stair、stepper、step machine、floor | Floor Climbing |
| hiit、interval training、crossfit | HIIT |
| strength、weight | Strength |
| yoga、pilates、stretch | Strength |
| run（且不含上述）| Road Run |
| 其他 | 标记为未知（让你选）|

## 重复检测规则

满足下面**全部**条件视为重复：

- 日期相同
- 类型相同
- 时长（秒）相同

**Skip duplicates** 只跳过重复行；**Add anyway** 全部加入（会出现两条相同记录 —— 只在 Garmin 把一次训练拆成两次导出时才有用）。

## 提示

- CSV 完全在浏览器本地解析。不会传到任何其他地方，只有你确认后的勾选行才入库。
- Garmin 的导出列名会随 app 版本和语言变化。如果导入器提示「找不到时长列」，多半是 Garmin 改了列名 —— 反馈给开发者修。
- 新出现的活动类型（划船、骑行等）目前会被识别成「未知」需要手动选 —— 这是有意的保守策略，避免错误归类。
