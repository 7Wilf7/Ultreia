# AI 教练

每日打卡式的 AI 教练对话，基于你的真实训练数据、目标赛事，和一个你自己掌控的长期记忆 blob。后端是 **DeepSeek 的 Anthropic 兼容接口** —— URL 写死，你只需要提供 API Key。

## 初次配置

1. 点右上角 header 里的 **API** 按钮。
2. 粘贴你的 DeepSeek API Key（[platform.deepseek.com](https://platform.deepseek.com/) 申请）。
3. 可选择一个 model preset。Key 存在 Supabase 的 `user_settings.api_key` 字段，受 RLS 保护只有你能读。
4. 打开 **AI Coach** tab。对话历史存在 Supabase（`coach_messages` 表），刷新和换设备都不会丢。

## 每次发消息时都发了什么

每条消息都会**重新拼装**整个请求 —— 没有缓存。Payload 分两部分：

**1. `system` 字段**（每次重建）：

- **固定 prompt** —— 定义教练角色和语气。源码在 `src/constants.js` 的 `FIXED_SYSTEM_PROMPT`。把用户作为决策者；禁止「必须 / 禁止」式语言；要求模型用用户的语言回复。
- **Profile 块** —— 年龄、性别、城市、职业、训练年限、伤病史、可用器材，以及（如果 Resting HR + Max HR 都填了）心率区间。源码在 [Profile](../src/utils/profile.js)。
- **Coach Config 块** —— 三个轴（style、output length、intervention level），每个三档（从软到严）。
- **Memory 块** —— 关于你的长期事实（见下文 Memory 章节）。
- **数据块** —— 当前本地时间、全部目标赛事、**精选的历史赛事子集**、最近 10 条非计划训练。

**2. `messages` 数组** —— Supabase 里的全部历史对话 + 新这一轮 user 消息。

## 历史赛事是被筛选过的

每次都发全部历史会迅速撑爆 prompt 并稀释关键信号。数据块里发的是**按类别精选**的子集：

- **10K / HM / Marathon / Hyrox / Other** —— 每类按日期取最近 3 条
- **Trail** —— 最近 3 条 + 最长距离的一条（如果最长就在最近 3 里就只 3 条）
- **Spartan** —— 最近 3 条 + 最难 tier 的一条（去重逻辑同上）

源码在 [AICoachTab.jsx](../src/components/AICoachTab.jsx) 的 `selectHistoryForPrompt`。

## Memory（长期记忆）

一段你（或 LLM）随时间维护的自由文本。这是「持久层」—— 比如「轻松日必须真的轻松，不然跟腱会犯」「备战 2026 UTMB CCC，8 月底 A 级比赛」这类。

两种更新方式：

- **Edit** —— 打开 Memory，点 Edit，自己写，Save。
- **Auto-update from chat** —— 把当前 memory + 最近对话发给 LLM，让它产出一份建议更新版。你审核后选 Accept 或 Discard。

那条 memory prompt 里明确要求模型保留持久事实、丢掉一次性琐事、控制在 500 词以内。

## 长对话软提示

`coach_messages` 累计到 **20 条**时，对话上方会出一条琥珀色软提示，建议你把要点固化进 Memory + Clear Chat。历史对话越长，旧消息越跟 system prompt 抢模型的注意力；定期固化进 Memory 能保持回复质量。点提示上的按钮直接跳到 Memory section。

## 把计划导入到 Calendar

每条 assistant 回复下方都有一个 **Import to Calendar** 按钮。点它会发起**第二次** LLM 调用，让模型把回复解析成 `{date, type, distance, duration, subTypes, notes}` 的 JSON 数组，弹一个 review modal 让你逐条调整后再导入。导入的项目以 `is_planned = true` 写入，在 Calendar 上以虚线框显示 —— 不会计入统计或 PR，除非你手动标记完成。

## Preview Prompt 预览

切 **Preview Prompt** 按钮可以看到具体发给 LLM 的内容。预览有 EN / 中 切换 —— **英文版才是真正发给 LLM 的**（指令执行更稳定），中文仅供你阅读。

桌面端同时打开 **Memory** 和 **Preview Prompt** 时，两张卡片会左右并排，方便你对比持久层和拼装后的 prompt。

## Token 上限

三处 LLM 调用（对话 / Memory 自动更新 / 计划提取）都把 `max_tokens` 设到 **8000**，这是 DeepSeek 在 Anthropic 兼容接口上的硬上限。Anthropic 按**实际输出 token** 计费，所以这个上限是免费的天花板 —— 只是用来防止句子或 JSON 被截断。

## 注意

- 目前只支持 DeepSeek。Endpoint URL 在 `DEFAULT_API_ENDPOINT`（[constants.js](../src/constants.js)），UI 不暴露。
- 如果 API 返回 200 OK 但 `content` 数组为空，对话里会显示 "No response."，同时浏览器控制台打 `[AI Coach] Empty reply` 把完整响应打出来 —— 方便排查模型 ID 错误之类的问题。
- API 报错（4xx/5xx）和网络错误以临时气泡显示在对话里，**不**写入 Supabase。刷新页面就没了。
