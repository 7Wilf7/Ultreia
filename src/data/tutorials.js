// Legacy in-app setup tutorials for the old BYOK flow. Normal users now use
// wallet-backed server keys and should not see these screens; keep the content
// only for compatibility with any older hidden entry points.
//
// Shape per tutorial:
//   title:    { zh, en }
//   warn?:    { zh, en }    — optional red banner at the top
//   steps:    [ { zh, en, link? } ]   — link is an optional URL shown under the step
//   footnote: { zh, en }    — grey cost/notes line at the bottom

export const TUTORIALS = {
  caiyun: {
    title: { zh: "彩云天气 API 申请教程", en: "Caiyun Weather API setup" },
    steps: [
      {
        zh: "注册账号：打开彩云开发者平台，用邮箱 + 密码注册，填写邮箱收到的验证码完成。",
        en: "Sign up: open the Caiyun developer platform, register with email + password, and enter the email verification code.",
        link: "https://platform.caiyunapp.com/login",
      },
      {
        zh: "实名认证：登录后点「立即认证」，选「个人开发者认证」。所属行业选「互联网」，应用场景选「天气」，填好资料 + 手机验证码后提交。",
        en: "Verify identity: after login click “Verify now”, choose “Individual developer”. Set industry to “Internet” and use-case to “Weather”, fill in your info + phone code, and submit.",
      },
      {
        zh: "创建应用：认证通过后新建应用。应用名字填 ultreia，接口类型选「天气」，应用场景选「天气服务」。⚠ 不要选任何付费套餐。",
        en: "Create an app: once verified, create a new application. Name it “ultreia”, set API type to “Weather” and scenario to “Weather service”. ⚠ Do NOT select any paid plan.",
      },
      {
        zh: "获取令牌：创建应用后，点进该应用的「访问控制」，复制里面的令牌（Token）。",
        en: "Get the token: after creating the app, open its “Access control” page and copy the token shown there.",
      },
      {
        zh: "回到本页：把令牌粘进上面的输入框，保存即可。",
        en: "Back here: paste the token into the field above and save.",
      },
    ],
    footnote: {
      zh: "新账号赠送约 1 万次免费额度（正常使用约够半年）；超出后约 25 元/万次。天气功能需要你自己的令牌才能用。",
      en: "New accounts get ~10,000 free calls (roughly half a year of normal use); beyond that ~¥25 per 10,000. Weather requires your own token to work.",
    },
  },

  deepseek: {
    title: { zh: "DeepSeek API 申请教程", en: "DeepSeek API setup" },
    steps: [
      {
        zh: "注册登录：打开 DeepSeek 开放平台，用手机号或邮箱注册登录。",
        en: "Sign up: open the DeepSeek open platform and register with phone or email.",
        link: "https://platform.deepseek.com/",
      },
      {
        zh: "充值：进入「充值」页，账户余额需大于 0 才能调用（最低充值很低，几块钱能聊很久）。",
        en: "Top up: go to Billing — you need a balance > 0 to make calls (minimum is tiny; a few dollars lasts a long time).",
      },
      {
        zh: "创建密钥：左侧「API keys」→「创建」，复制 sk- 开头的密钥（只显示一次，务必当场复制保存）。",
        en: "Create a key: under “API keys” click Create, then copy the sk-… key (shown only once — copy it right away).",
      },
      {
        zh: "回到本页：Provider 选 DeepSeek，把密钥粘进输入框保存。",
        en: "Back here: set Provider to DeepSeek, paste the key, and save.",
      },
    ],
    footnote: {
      zh: "价格约 $0.4/百万输入 token，一次教练对话约几厘钱，很便宜。",
      en: "About $0.4 per million input tokens — a single coach reply costs a fraction of a cent.",
    },
  },
};
