# Running 配速分类

路跑（Road Run）每条记录都会带一个**配速子类**，让图表和 AI 教练能分析你的强度分布。一共 4 种配速子类 + 1 个独立标记。

## 子类

| 子类 | 含义 |
|---|---|
| Easy Run | 对话配速，恢复跑/打底有氧 |
| Aerobic Run | 稳定有氧，乳酸阈以下 |
| Tempo Run | 乳酸阈区间，「舒适地难」 |
| Interval Run | 阈值以上的间歇，VO2max 区间 |

外加一个可与任何配速子类共存的独立标记：

- **Race** —— 标记为比赛性质的训练。在活动列表里 chip 颜色会变成警示橙。

## 自动分类（仅 Garmin CSV 导入）

导入 Garmin CSV 时，Road Run 行会按平均心率预填配速子类，逻辑在 `autoClassifyRun`（[utils/format.js](../src/utils/format.js)）：

| 平均心率（bpm）| 分配的子类 |
|---|---|
| 缺失 | Easy Run |
| < 150 | Easy Run |
| 150 – 164 | Aerobic Run |
| 165 – 174 | Tempo Run |
| ≥ 175 | Interval Run |

这套阈值是**全局硬编码常量**，**不**基于你 Profile 里的个人心率区间。设计目标是中等训练水平的成年人；如果你的心率区间显著偏高或偏低，预填可能偏差，**导入预览界面可以逐条改**再确认。

> Trail Run / Hiking / Floor Climbing **不**自动分类 —— 地形主导配速，按心率分容易误判。函数对这些类型返回空子类。

## 手动选择子类

通过表单新建活动时，Road Run 默认 **Easy Run**。保存前点其他配速 chip 即可换。配速 chips 是互斥的（选新的替换旧的）；Race 标记独立切换。

## 在统计里怎么体现

- **Charts → Run type distribution** 图按子类聚合 Road Run，权重是**时长（秒）**而非次数。一次 90 分钟 tempo 的训练负荷大于 3 次 20 分钟轻松跑，按时长加权更能反映强度分配。
- 其他跑步类型（Trail / Hiking / Floor Climbing）不进这个图，因为没配速子类。
- **AI 教练数据块**发给模型的每条活动后面都带子类（写在括号里），教练能区分上周 60 km 是轻松底子还是 tempo 偏多。

## 注意

- 子类以数组形式存在 workout 记录上（`subTypes: ["Tempo Run", "Race"]`），这就是 Race 标记和配速桶共存的方式。
- 改阈值要改 `src/utils/format.js` 里的 `autoClassifyRun`，目前没有 UI，也没有按用户个性化覆盖的机制。
- 如果你 Profile 里填了 Resting HR + Max HR + 选了一种心率区间方法，Charts tab 会额外渲染 **HR Zone Distribution** 卡片 —— 那个**才**用你的个人 Karvonen 区间。详见 [图表](charts.md)。
