# 训练记录

Training Studio 里每条训练都归到三大类之一：**Run（跑步类）**、**Strength（力量）**、**HIIT**。这份记录是所有数据的源头 —— 顶部统计条、图表、AI 教练的数据块、个人最佳聚合，都从它读。

## Activity 类型

| 大类 | 具体类型 | 记录字段 |
|---|---|---|
| Run | Road Run（路跑）| 距离、时长、配速、心率、累计爬升、步频、GAP、有氧 TE |
| Run | Trail Run（越野跑）| 距离、时长、配速、心率、累计爬升、有氧 TE |
| Run | Hiking（徒步）| 距离、时长、配速、心率、累计爬升、有氧 TE |
| Run | Floor Climbing（爬楼/楼梯机）| 时长、心率、累计爬升（无水平距离）|
| Strength | Strength（力量）| 时长、心率、可选择身体部位 |
| HIIT | HIIT | 时长、心率、有氧 TE |

子类规则因大类而异：

- **Road Run** 必须选一种配速子类（Easy / Aerobic / Tempo / Interval），可加 `Race` 标记。具体见 [Running 配速分类](running.md)。
- **其他 Run 类型**（Trail / Hiking / Floor Climbing）可加 `Race` 标记，但不分配速 —— 地形主导配速，按心率分类会误导。
- **Strength** 可勾选 Upper Body / Lower Body / Core 任意组合。
- **HIIT** 没有子类。

> Active Recovery（积极恢复）**不是**一种 activity 类型。它是**日级标签**（比如 `massage`），在 Calendar 的某一天上勾选。

## 添加训练（手动）

1. **Training** tab → 点 **Add Activity**。
2. 选日期和类型。Road Run 默认子类 Easy Run，其他类型默认空。
3. 按你测到的数据填。**日期和时长是必填**，距离/心率/爬升/步频/GAP/TE 都可选，没量到就留空。
4. Save。新行会出现在 Activities 列表顶部，立刻反映到周期统计和图表里。

## 编辑训练

Training 或 Calendar 上点任一行就进内联编辑模式。点外面会取消 —— 如果有未保存改动会弹确认框，避免误丢。

## 批量操作

- **Select mode**（Activities 右上角）：勾选多行批量删除。
- **Upload .csv**：打开 Garmin CSV 导入流程，见 [数据导入](data-import.md)。

## 筛选和周期

- Training tab 顶部的 **Global Filter** chips 同时作用于 Activities 列表和 Charts 子视图。可按跑步子类（Road / Trail / Hiking / Floor Climbing）、力量身体部位、HIIT 筛选。
- **Period Selector**（Week / Month / Quarter / Year / Custom / All）控制统计条和 Activities 列表的时间范围，**不**控制 Charts —— 图表有自己的周期 chips。

## 注意

- 从 AI 教练导入的**计划训练**（planned workouts）只在 Calendar 上显示，**不**进 Training 列表、不进统计条、不进图表、不进 PR bar。只有你手动标记完成后才计入。
- 每行右侧的 8 列指标网格（距离/爬升/时长/配速/GAP/心率/TE/步频）只渲染有值的格子，空字段不显示，但列对齐不丢。
- 移动端（<1024px 宽）会去掉网格，改成 flex 自动换行布局。
