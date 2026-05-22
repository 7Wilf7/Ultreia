# 数据导入（Garmin CSV）

Training Studio 支持从 **Garmin Connect 的 CSV 导出**批量导入活动。（直接解析 `.fit` 文件的功能在 commit `487f409` 里移除了，目前批量路径只有 CSV。）

## 从 Garmin Connect 导出

1. 进 Garmin Connect → **Activities** → 列表视图。
2. 按需要筛选 / 选日期范围（导入器不挑 —— 每行都会让你预览）。
3. 点列表右上角的 **Export CSV** 按钮。
4. 保存到本地。

## 导入流程

1. 打开 **Training** tab → **Activities** 子视图。
2. 点 **Upload .csv**，选刚才保存的文件。
3. 可能依次出现两个审核弹窗：
   - **未知活动类型** —— 如果某些行的活动类型映射器不认识（比如「Open Water Swim」「Padel」），会让你为每条手动选一个 Training Studio 类型。映射器涵盖常见情形：跑步、越野跑、徒步、走路、楼梯机、HIIT、CrossFit、力量、举铁、瑜伽、普拉提。
   - **重复警告** —— 如果某行的日期/类型/时长跟已有记录完全一致，会让你选 **Skip duplicates（跳过重复）** 或 **Add anyway（强制加入）**。
4. 接着是 **Review** 面板，列出每行的解析结果和勾选框：
   - 不想导入的行取消勾选。
   - Road Run 行可以通过下拉框覆盖自动分配的配速子类。
5. 点 **Import** 把勾选的行写到 Supabase。

## 解析了哪些字段

导入器找以下 Garmin 列名（大小写不敏感，duration 字段按顺序取第一个匹配）：

| CSV 列名 | 映射到 |
|---|---|
| Activity Type | type（走映射器）|
| Date | date（只取 YYYY-MM-DD 部分）|
| Distance | distance（km）|
| Time / Total Time / Moving Time / Elapsed Time | duration |
| Avg HR | hr |
| Max HR | maxHR |
| Total Ascent | ascent |
| Avg Run Cadence | cadence |
| Aerobic TE | aerobicTE |
| Avg GAP | gap（grade-adjusted pace，坡度调整配速）|

配速自动算：`duration / distance`（仅当两者都 > 0）。Strength 和 HIIT 的 pace 强制为 0 —— 这些类型没有有意义的配速。

## 活动类型映射

映射器读小写的 "Activity Type" 单元格：

| 包含关键字 | 映射为 |
|---|---|
| `trail` | Trail Run |
| `hiking`、`walking`、`walk` | Hiking |
| `stair`、`stepper`、`step machine`、`floor` | Floor Climbing |
| `hiit`、`interval training`、`crossfit` | HIIT |
| `strength`、`weight` | Strength |
| `yoga`、`pilates`、`stretch` | Strength |
| `run`（且不含上述）| Road Run |
| 其他 | 标记为未知（会让你选）|

源码在 [ActivitiesTab.jsx](../src/components/ActivitiesTab.jsx) 的 `mapGarminActivityType`。

## 重复检测

满足下面**全部**条件视为重复：

- 日期相同（YYYY-MM-DD）
- 类型相同
- 时长（秒）相同

源码在 `src/utils/format.js` 的 `isDuplicate`。**Skip** 只跳过重复行；**Add anyway** 全部加入（会出现两条相同记录 —— 只在 Garmin 把一次训练拆成两次导出时才有用）。

## 注意

- CSV 完全在浏览器本地解析。**不**上传到任何地方，只有你确认后的每行才作为独立记录写到 Supabase。
- Garmin 的 CSV 列名会随 app 版本 / 语言 / 设备类型变化。如果导入器说「找不到时长列」，打开浏览器控制台 —— 它会把实际看到的表头打出来，方便定位差异。
- 活动类型映射器写得保守。新类型（比如划船、骑行）目前会进未知弹窗 —— 要原生支持得改 `mapGarminActivityType`。
- Garmin 给每行的数字 `id` 会被丢弃，Supabase 端生成 UUID。所有 `_` 前缀的暂存字段在写库前会被剥掉。
