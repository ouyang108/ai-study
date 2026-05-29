# 00 - 从零开始：你的第一个 AI 程序

欢迎！这篇文档写给**完全没有 AI 背景**的开发者。

你会写 JS/TS，会用 ChatGPT 聊天，但不知道"AI 开发"到底是怎么回事？你来对地方了。

读完这篇文档，你会：
- 搞懂 LLM 到底是什么（不是魔法，是一个数学函数）
- 在本地跑起第一个 AI 程序
- 理解为什么 AI 编程和 AI 聊天完全不是一回事

---

## 1. 什么是 LLM（用大白话讲清楚）

### 1.1 它不是一个数据库

很多人第一次接触 ChatGPT，会觉得它是一个"超强版 Google"——你问它问题，它从某个巨大数据库里搜出答案。

**大错特错。**

LLM（Large Language Model，大语言模型）不存数据，不做搜索。它只做一件事：

> **预测下一个词（token）是什么。**

你把一段文字给它，它算出"接下来最可能是什么文字"，然后输出。

这就像一个超级强大的**自动补全**。你手机键盘猜你下一个字打什么——LLM 也是干这个的，只不过它读了互联网上几乎所有文字，所以"猜"得特别准。

### 1.2 什么是 Token（词元）

LLM 不能直接理解"文字"。它先把文字切成小块，每一块叫一个 **token**。

举个例子。句子 `"我喜欢编程"` 可能被切成：

```
["我", "喜欢", "编程"]
```

英文 `"I love programming"` 可能被切成：

```
["I", " love", " programming"]
```

注意 `" love"` 前面有空格——这说明 token 不一定是完整的词。

**为什么要知道这个？**
- API 按 token 数量收费（输入 + 输出都算钱）
- 每个模型有 token 上限（context window），超过了就塞不进去

一个粗略的估算：**1 个 token ≈ 0.75 个英文单词 ≈ 0.5 个汉字**。

### 1.3 什么是 Temperature（温度）

Temperature 控制模型输出的**随机程度**。

| Temperature | 效果 | 适合场景 |
|---|---|---|
| **0** | 每次回答几乎一样，选概率最高的词 | 数学计算、代码生成、事实问答 |
| **0.5** | 有一定变化，但不会跑偏 | 日常对话、翻译 |
| **1.0** | 很发散，脑洞大开 | 创意写作、头脑风暴 |

**原理**（不用深究，有个概念就行）：
模型在预测下一个 token 时，每个可能的 token 都有一个"概率分数"。Temperature 会调整这些概率的分布——低温度让高分 token 更高，低分 token 更低；高温度让分布更均匀，所以低概率的词也有机会被选中。

```typescript
// temperature 不是"智商"开关——温度低不代表"更聪明"，
// 温度高也不代表"更蠢"。它只是控制输出的随机性。
```

### 1.4 什么是 Context Window（上下文窗口）

把 LLM 想象成一个**只有短期记忆的人**。

它一次能"记住"的内容是有限的。这个限制就是 context window（上下文窗口）。

- GPT-4o 的 context window 是 128K tokens（约等于一本中篇小说的长度）
- DeepSeek-V3 的 context window 也是 128K tokens
- Claude 3.5 Sonnet 是 200K tokens

> **时效提示**：模型上下文窗口、价格、限额会频繁变化。这里的数字用于建立概念，实际项目请以各平台控制台和官方文档为准。

**关键点**：
- 你问的问题 + 模型之前的回答 + 你给的文件内容 = 都在 context window 里
- 超过了怎么办？你要自己裁剪（后面会讲）

### 1.5 最关键的认知：LLM 不"知道"事实

LLM 不是在查数据库，它是在**预测看起来合理的文字**。

这意味着：
- 它可能**编造事实**（这叫 hallucination，幻觉）。比如它会把"A 公司的 CEO 是张三"说得斩钉截铁，实际上根本没这个人。
- 它不是"故意骗你"——它只是在统计意义上，觉得"张三"是一个很适合接在"A 公司的 CEO 是"后面的词。
- 这就是为什么你不能直接用 LLM 回答"你们公司内部制度第几条是什么"——它没读过，它会编。

**记住这句话：LLM 不是在回答你的问题，它是在完成一段文字。**

---

## 2. 搭建开发环境（手把手）

### 2.1 前置条件

你需要 **Node.js 18 或更高版本**。

打开终端，确认版本：

```bash
node --version    # 应该 >= v18.0.0
npm --version     # 确认 npm 也可用
```

如果没装，去 [nodejs.org](https://nodejs.org) 下载 LTS 版本，一路下一步安装即可。

### 2.2 创建项目

```bash
# 在桌面创建一个新文件夹
mkdir ~/Desktop/my-first-ai

# 进入文件夹
cd ~/Desktop/my-first-ai

# 初始化 npm 项目（-y 表示全部默认，不用一个个回答问题）
npm init -y
```

### 2.3 安装依赖

```bash
# 三个包：
# openai — 调用 OpenAI 的 API（也兼容 DeepSeek 等）
# @anthropic-ai/sdk — 调用 Anthropic（Claude）的 API  
# dotenv — 从 .env 文件读取环境变量（保护你的 API 密钥）
npm install openai @anthropic-ai/sdk dotenv

# 安装 TypeScript（开发依赖）
npm install -D typescript @types/node tsx
```

### 2.4 配置 API 密钥

在项目根目录创建 `.env` 文件：

```bash
# .env — 存放你的 API 密钥（千万别上传到 GitHub！）
OPENAI_API_KEY=sk-your-openai-key-here
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key-here
DEEPSEEK_API_KEY=sk-your-deepseek-key-here
```

**`.env` 文件非常重要——一定不要提交到 Git！** 在里面写上真实的密钥后，确保 `.gitignore` 里有 `.env`。

### 2.5 怎么获取 API 密钥

| 平台 | 获取地址 | 新用户有免费额度吗？ | 适合 |
|---|---|---|---|
| **DeepSeek** | [platform.deepseek.com](https://platform.deepseek.com) | 注册就送额度 | **最便宜，强烈推荐学习用** |
| **OpenAI** | [platform.openai.com](https://platform.openai.com) | 新用户有少量免费额度 | 功能最强，但贵 |
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com) | 需充值 | Claude 模型 |

**强烈建议新手用 DeepSeek 入门**：价格通常很低，花几块钱就能玩很久。而且 DeepSeek 的 API 兼容 OpenAI 的 Chat Completions 格式，后面学的代码基本只需要换 `baseURL` 和 `model`。

> **价格提示**：本文不把价格当成核心知识点，所有价格都只看作示例。真实计费以各平台最新价格页为准。

### 2.6 配置 TypeScript

创建 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

创建源码目录：

```bash
mkdir src
```

---

## 3. 第一个 API 调用（Hello World）

### 3.1 写代码

创建 `src/hello-ai.ts`：

```typescript
// hello-ai.ts — 你的第一个 AI 程序
// 这段代码向 AI 发送一条消息，然后打印回复

import OpenAI from "openai";
// dotenv/config 会自动读取 .env 文件中的环境变量
import "dotenv/config";

// 1. 创建一个客户端实例
//    这是你和 AI 之间的"连接器"
const client = new OpenAI({
  // apiKey 从环境变量中读取——永远不要硬编码密钥到代码里！
  apiKey: process.env.OPENAI_API_KEY,

  // 🔥 如果你用 DeepSeek（推荐），取消下面这行的注释
  // baseURL: "https://api.deepseek.com/v1",
  //
  // DeepSeek 的 API 格式和 OpenAI 一模一样，换这行就能用。
  // 然后记得把 apiKey 换成 process.env.DEEPSEEK_API_KEY
});

// 2. 发送一个聊天请求
// 本系列入门示例保留 chat.completions.create()：
// - DeepSeek、Ollama、vLLM、LiteLLM 等大量 OpenAI-compatible 服务都支持它
// - OpenAI 新项目可优先看 Responses API，但学习“消息数组/上下文/工具调用”时这个接口更通用
const response = await client.chat.completions.create({
  // model 是你要用的模型名称
  model: "gpt-4o",
  // 如果用的 DeepSeek，改成:
  // model: "deepseek-chat",

  // messages 是你和模型的"对话记录"
  // 每条消息都有 role（角色）和 content（内容）
  messages: [
    {
      role: "user", // role 为 "user" 表示这是用户说的话
      content: "你好，请用通俗的语言解释一下什么是递归？",
    },
  ],
});

// 3. 打印模型的回复
// response.choices 是一个数组，通常取第一个（[0]）
// .message.content 是模型回复的文字内容
console.log(response.choices[0].message.content);
```

### 3.2 运行

```bash
# 用 tsx 直接运行 TypeScript（不需要先编译）
npx tsx src/hello-ai.ts
```

你应该会看到类似这样的输出：

```
递归就像俄罗斯套娃——一个函数在执行过程中调用自己，每次用更
简单的问题来逼近最终答案。比如计算 5 的阶乘：
5! = 5 × 4! → 4! = 4 × 3! → ... 直到 1! = 1，然后一层层返回结果。

关键是要有一个"终止条件"，否则就会无限循环。就像套娃不能无限
套下去，最小的那个就是终止条件。
```

### 3.3 代码逐行讲解

让我们仔细看看最关键的部分。

#### `messages` 是什么？

`messages` 是一个数组，里面装着本次对话的**全部**消息。它不是"把最新一条消息发过去"，而是把整个数组发过去。

```typescript
messages: [
  { role: "user", content: "你好，解释一下什么是递归？" },
],
```

为什么叫 `messages`（复数）？因为你可以传多条消息进去——后面会详细讲。

#### `role` 是什么意思？

每条消息都有一个 `role`，告诉模型"这句话是谁说的"：

| role | 含义 | 谁说的 |
|---|---|---|
| `"system"` | 系统指令 | 你（开发者）——用来设定 AI 的行为规则 |
| `"user"` | 用户消息 | 使用你的产品的人 |
| `"assistant"` | 助手消息 | AI 模型之前的回复 |

大多数时候你只需要 `"user"` 和 `"assistant"`。`"system"` 是可选的，后面会讲。

#### 为什么是 `response.choices[0].message.content`？

API 返回的 `response` 对象结构大致是这样：

```
response
  └─ choices: [                    // 数组，通常只有一个元素
       {
         index: 0,
         message: {
           role: "assistant",      // 角色永远是 "assistant"
           content: "递归就像..."   // ← 这就是你要的回复文字
         },
         finish_reason: "stop"     // "stop" 表示正常结束
       }
     ]
  └─ usage: {                      // token 用量统计
       prompt_tokens: 15,          // 你输入消耗的 token 数
       completion_tokens: 120,     // 模型输出消耗的 token 数
       total_tokens: 135           // 总共多少
     }
```

所以 `response.choices[0].message.content` 的含义是：
- `.choices` —— 模型的候选回复
- `[0]` —— 取第一个（默认只有一个）
- `.message` —— 这条消息对象
- `.content` —— 消息的文字内容

#### 如何查看消耗了多少 Token

```typescript
// 在你上面的代码后面加这几行
console.log("--- Token 用量 ---");
console.log(`输入 tokens:  ${response.usage?.prompt_tokens}`);
console.log(`输出 tokens:  ${response.usage?.completion_tokens}`);
console.log(`总计 tokens:  ${response.usage?.total_tokens}`);
```

这对控制成本非常重要——每次调用都知道花了多少钱。

---

## 4. 理解 API 调用的本质

### 4.1 每一次调用都是"失忆"的

这是新手最容易踩的坑。看这段代码：

```typescript
// ❌ 错误理解：第一轮告诉模型"我叫小明"，
//            第二轮它会记住我的名字
const round1 = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "我叫小明" }],
});
// 模型回复: "你好小明！有什么可以帮你的？"

const round2 = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "我叫什么名字？" }],
});
// 模型回复: "你没有告诉我你的名字。" ❌
```

**为什么第二次不知道你叫小明？**

因为 API 的每一次调用都是**完全独立的**。模型不会在服务器上"记住"你之前的对话。第一次调用结束后，服务器就把你的对话忘光了。

你可以把每个 `chat.completions.create()` 想象成一个**纯函数**。这里使用 Chat Completions 是为了兼容 DeepSeek 等 OpenAI-compatible 服务；如果你只接 OpenAI 官方新项目，可以再学习 Responses API 的写法。
- 你输入什么，它就输出什么
- 没有副作用，没有记忆
- 同样的输入永远产生同样的输出（temperature=0 时）

### 4.2 怎么实现"对话"？自己管理历史记录

既然模型不记忆，那 ChatGPT 是怎么跟你对话的？答案是：**每次对话时，前端把整段历史一起发过去**。

```typescript
// ✅ 正确做法：把对话历史手动拼接好，一次性发过去
const messages = [
  // 第一轮：你告诉模型你的名字
  { role: "user", content: "我叫小明" },
  // 上一轮模型的回复（你需要自己保存下来！）
  { role: "assistant", content: "你好小明！有什么可以帮你的？" },
  // 第二轮：你的新问题
  { role: "user", content: "我叫什么名字？" },
];

const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: messages, // 把整个历史数组发过去
});

console.log(response.choices[0].message.content);
// 输出: "你叫小明。" ✅ 这次对了！
```

**这就是 AI 应用开发的核心模式**：
1. 你维护一个 `messages` 数组
2. 每次用户说新东西，就往数组里 push 一条 `{ role: "user", ... }`
3. 每次模型回复，就往数组里 push 一条 `{ role: "assistant", ... }`
4. 下次调用 API 时，把整个数组发过去

```typescript
// 一个简化的对话管理示例
const history: { role: "user" | "assistant"; content: string }[] = [];

async function chat(userInput: string) {
  // 把用户输入加入历史
  history.push({ role: "user", content: userInput });

  // 把整个历史发给模型
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: history,
  });

  const reply = response.choices[0].message.content;
  // 把模型回复也加入历史
  history.push({ role: "assistant", content: reply });

  return reply;
}

await chat("我叫小明");
await chat("我叫什么名字？"); // ✅ 模型能回答出来
```

### 4.3 这就是为什么 Context Window 很重要

因为你每次都把**整个对话历史**发过去，对话越长，消耗的 token 越多。

当对话的 token 总数接近模型的 context window 上限时，你就必须做取舍——要么删掉最早的对话（"滑动窗口"策略），要么对历史做摘要压缩。这些技巧会在后续文档中深入讲解。

---

## 5. 三个核心概念（建立心智模型）

### 5.1 System Prompt（系统提示词）

`role: "system"` 的消息用来**设定 AI 的行为和角色**。它不在对话中显示，但会影响模型的所有回复。

```typescript
// 示例：让 AI 扮演不同角色，问同一个问题
const question = "你觉得今天天气怎么样？";

// ---- 角色 1: 默认助手 ----
const response1 = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: "你是一个有帮助的助手。" },
    { role: "user", content: question },
  ],
});
console.log("默认助手:", response1.choices[0].message.content);
// 输出: "我无法获取实时天气数据，但根据你的位置..."
//       很理性，很客观

// ---- 角色 2: 悲观主义者 ----
const response2 = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: "你是一个极度悲观的人，看什么都往最坏处想。" },
    { role: "user", content: question },
  ],
});
console.log("悲观主义者:", response2.choices[0].message.content);
// 输出: "肯定又是阴天，说不定还会下雨。反正天气好不好
//       我都不开心，唉..."
//       完全不同的风格！
```

**System Prompt 不是魔法**——它和 user message 本质一样，都是被塞进 context window 的文字。只是模型在训练时被教导要优先遵循 system 级别的指令。

**最佳实践**：system prompt 应该写在 user message **前面**。它通常包含：
- 角色定义（"你是一个..."）
- 行为规则（"不要编造事实"、"如果不知道就说不知道"）
- 输出格式要求（"始终用 JSON 格式回复"）

### 5.2 Temperature（温度）— 仅限标准模型

我们之前介绍了概念，现在来看代码效果。

> **重要前提**：`temperature` 主要用于**标准模型**。
> 许多推理模型或“深度思考”模式会限制 `temperature` / `top_p` / `top_k` 等采样参数，但不同厂商规则不同。
> 实战中要按具体模型文档处理，不要假设所有推理模型的参数完全一致。

```typescript
// === 标准模型：temperature 有效 ===
// 同一个问题，不同的 temperature
const prompt = "写一首关于编程的五言绝句";

// temperature = 0：稳定、可预测
const res0 = await client.chat.completions.create({
  model: "gpt-4o",          // 标准模型，支持 temperature
  temperature: 0,           // 最低随机性
  messages: [{ role: "user", content: prompt }],
});
// 每次运行输出基本一样

// temperature = 1.0：发散、有创意
const res1 = await client.chat.completions.create({
  model: "gpt-4o",
  temperature: 1.0,         // 高随机性
  messages: [{ role: "user", content: prompt }],
});
// 每次运行输出都可能不同

// === 推理模型：通常不用 temperature，各家参数不同 ===
// ——— OpenAI o1/o3 ———
const resO3 = await openai.chat.completions.create({
  model: "o3",
  reasoning_effort: "medium",    // OpenAI 推理模型专用: low / medium / high
  messages: [{ role: "user", content: "1+2×3=?" }],
});

// ——— Anthropic Claude Extended Thinking ———
const resClaude = await anthropic.messages.create({
  model: "claude-sonnet-4-20250514", // 示例快照 ID，实际以 Anthropic 控制台为准
  thinking: {                    // Anthropic 的推理控制参数
    type: "enabled",
    budget_tokens: 4000,         // 推理预算 token 数（越大思考越深）
  },
  max_tokens: 4096,
  messages: [{ role: "user", content: "1+2×3=?" }],
});

// ——— DeepSeek-R1 ———
const resR1 = await openaiDeepSeek.chat.completions.create({
  model: "deepseek-reasoner",    // DeepSeek 推理模型的兼容 model ID，实际以 DeepSeek 文档为准
  // R1 自动推理，无需额外参数。直接调用即可
  messages: [{ role: "user", content: "1+2×3=?" }],
});
// 推理模型内部自动控制思考深度，不需要外部调温
```

**经验法则（标准模型）**：
- 代码生成、数学、逻辑推理 → `temperature: 0` 到 `0.2`
- 日常对话、翻译、总结 → `temperature: 0.3` 到 `0.7`
- 创意写作、头脑风暴 → `temperature: 0.7` 到 `1.0`
- 超过 `1.5` 一般不建议，输出质量会明显下降

**推理模型（通常不用 temperature，各家用不同参数）**：
| 厂商 | 模型 | 控制参数 | 取值 | 文档 |
|------|------|---------|------|------|
| OpenAI | o1/o3 | `reasoning_effort` | `"low"` / `"medium"` / `"high"` | [文档](https://platform.openai.com/docs/guides/reasoning) |
| Anthropic | Claude Extended | `thinking.budget_tokens` | 如 1600/4000/10000（越大思考越深） | [文档](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking) |
| DeepSeek | R1 / Reasoner | 通常无额外参数 | 自动推理 | [文档](https://api-docs.deepseek.com/guides/reasoning_model)

共同点不是“永远同一个参数”，而是：**不要把标准模型的调参经验直接套到推理模型上**。

### 5.3 Max Tokens（最大输出长度）

限制模型**一次回复最多生成多少 token**。这不会影响输入，只限制输出。

```typescript
// 不加限制 — 模型可能会生成很长
const long = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "介绍一下中国历史" }],
  // 不设 max_tokens，模型可能会输出几千字
});

// 限制 50 个 token
const short = await client.chat.completions.create({
  model: "gpt-4o",
  max_tokens: 50, // 限制输出在 50 tokens 以内
  messages: [{ role: "user", content: "介绍一下中国历史" }],
});
console.log(short.choices[0].message.content);
// 输出会在 50 tokens 左右被截断
```

**为什么要限制？**
- **控制成本**：输出 token 也收费，不限制的话可能一次调用花很多钱
- **控制延迟**：输出越长，等待时间越长
- **防止跑偏**：有时候模型会"停不下来"，一直生成无关内容

---

## 6. 从对话到编程的思维转变

这是最重要的部分。你跟 ChatGPT 聊天的经验，**在编程时大部分不适用**。

| 聊天时 | 编程时 |
|---|---|
| 你可以追问、纠正、补充说明 | **你必须一次给出完整指令**。代码不会"追问"你，它只会按你写的执行 |
| ChatGPT 记得你前面说的 | **每次 API 调用都是全新的**。你必须自己存储和发送对话历史 |
| 回答不满意可以"再说一遍" | **你必须写代码检测质量、自动重试**。没有人在旁边帮你点"重新生成" |
| 一个聊天窗口解决一切 | **你需要自己设计架构**：记忆管理、错误处理、质量评估 |
| 免费（或者订阅费） | **按 token 付费**。每行代码、每次调用都有成本 |

### 6.1 对话思维 vs 编程思维：一个具体例子

**聊天时你做这件事**：
> 你："给我写一个排序函数"
> ChatGPT：写了冒泡排序
> 你："不对，我要快速排序，用 TypeScript，要处理空数组的情况"
> ChatGPT：重新写

**编程时你必须这么做**：

```typescript
// 你必须把完整的需求一次性写清楚
const response = await client.chat.completions.create({
  model: "gpt-4o",
  temperature: 0, // 代码生成用低温
  messages: [
    {
      role: "system",
      content: [
        "你是一个资深前端工程师。",
        "写代码时：",
        "1. 用 TypeScript",
        "2. 处理边界情况（空数组、重复元素等）",
        "3. 加上中文注释",
        "4. 只输出代码，不要解释",
      ].join("\n"),
    },
    {
      role: "user",
      content: "写一个快速排序函数，要求原地排序",
    },
  ],
});
```

看到了吗？你不能指望模型"问清楚再说"，因为你的代码里没有这个流程。你必须在写代码的时候就把所有要求和边界情况告诉模型。

### 6.2 这意味着什么

作为 AI 开发者，你的核心工作变成了：

1. **设计 prompt**：怎么用文字精确描述你要什么
2. **管理上下文**：哪些历史记录要保留，哪些要丢掉
3. **处理输出**：模型返回的不一定是你想要的格式，你需要解析、验证、重试
4. **控制成本和质量**：找到 token 用量和输出质量之间的平衡点

---

## 7. 学习路径指引

以下是你从入门到上线的完整学习路线。每篇文档都是独立的，你可以按顺序读，也可以按需要跳到感兴趣的部分。

### Stage 1：能调用 API，理解基础概念（你现在在这里）

你已经知道什么是 LLM、token、temperature、context window。下一步：

- **→ [03-提示词工程-Prompt-Engineering.md](./03-提示词工程-Prompt-Engineering.md)** — 深入学习 prompt 技巧，学会怎么让 AI 输出你想要的格式
- **→ [04-技能系统-Skills.md](./04-技能系统-Skills.md)** — 了解 Skills（可复用的 AI 能力模块）
- **→ [05-AI幻觉-Hallucination.md](./05-AI幻觉-Hallucination.md)** — 深入理解幻觉问题，学会怎么减少它

### Stage 2：能做 RAG 知识库

RAG 让模型能"读取"你的私有文档。这是大多数企业 AI 应用的基础。

- **→ [06-检索增强生成-RAG.md](./06-检索增强生成-RAG.md)** — RAG（检索增强生成）完整讲解
- **→ [15-数据与架构-Data-Architecture.md](./15-数据与架构-Data-Architecture.md)** — 数据架构设计

### Stage 3：能做 Agent

Agent 让 AI 不只是回答问题，而是能**执行操作**——调用工具、搜索网页、操作数据库。

- **→ [01-AI智能体-AI-Agent.md](./01-AI智能体-AI-Agent.md)** — AI Agent 概念精讲
- **→ [02-MCP协议-Model-Context-Protocol.md](./02-MCP协议-Model-Context-Protocol.md)** — MCP（模型上下文协议），给 Agent 接上工具

### Stage 4：能上线产品

当你有了可用的 AI 应用后，要考虑部署、成本、性能。

- **→ [14-部署与成本-Deployment-Cost.md](./14-部署与成本-Deployment-Cost.md)** — 部署和成本优化
- **→ [10-模型选型-Model-Selection.md](./10-模型选型-Model-Selection.md)** — 不同模型怎么选
- **→ [08-上下文管理-Context-Management.md](./08-上下文管理-Context-Management.md)** — 上下文管理深入
- **→ [11-推理优化-Inference-Optimization.md](./11-推理优化-Inference-Optimization.md)** — 推理加速

### 其他参考文档

- **[09-Token化-Tokenization.md](./09-Token化-Tokenization.md)** — Token 的底层原理
- **[12-缓存与流式-Caching-Streaming.md](./12-缓存与流式-Caching-Streaming.md)** — 缓存和流式输出
- **[13-多模态AI-Multimodal.md](./13-多模态AI-Multimodal.md)** — 多模态（图片、语音）
- **[07-进阶知识-Advanced-Topics.md](./07-进阶知识-Advanced-Topics.md)** — 进阶话题合集

**不用一次性读完。** 先把 Stage 1 的三篇看了，然后动手做练习。遇到不会的再回来查。

---

## 8. 你的第一个练习

读完文档不代表学会。动手写代码才是。

### 练习 1：修改 System Prompt

让 AI 用**鲁迅的风格**回答问题。

**提示**：修改 `messages` 数组中的 `role: "system"` 那一条。你不需要懂鲁迅——告诉它"用鲁迅的风格"就行，试试看。

```typescript
// 框架代码，补全它
const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [
    {
      role: "system",
      content: "你现在的身份是鲁迅。...", // ← 你来补全
    },
    {
      role: "user",
      content: "你觉得做程序员有前途吗？",
    },
  ],
});
console.log(response.choices[0].message.content);
```

**预期效果**：模型的回复应该带有鲁迅特有的文风——犀利、略带讽刺、半文半白。

### 练习 2：实现命令行多轮对话

写一个简单的 Node.js 脚本，在终端里和 AI 连续对话（就像 ChatGPT 一样）。

**要求**：
- 用 `readline` 模块（Node.js 内置）读取用户输入
- 维护一个 `messages` 数组保存对话历史
- 输入 `exit` 或 `quit` 退出
- 输入 `clear` 清空对话历史

**提示框架**：

```typescript
// multi-turn-chat.ts — 命令行多轮对话练习
import OpenAI from "openai";
import * as readline from "readline";
import "dotenv/config";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const history: { role: "system" | "user" | "assistant"; content: string }[] = [
  { role: "system", content: "你是一个有帮助的助手。" },
];

// 创建 readline 接口，用于读取终端输入
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function askQuestion() {
  rl.question("你: ", async (input) => {
    // 处理特殊命令
    if (input === "exit" || input === "quit") {
      console.log("再见！");
      rl.close();
      return;
    }
    if (input === "clear") {
      history.length = 1; // 只保留 system prompt
      console.log("对话历史已清空");
      askQuestion();
      return;
    }

    // TODO: 把用户输入加入 history
    // TODO: 调用 API，获取回复
    // TODO: 把回复加入 history
    // TODO: 打印回复
    // TODO: 再次调用 askQuestion() 等待下一轮输入
  });
}

console.log("开始对话！（输入 exit 退出，输入 clear 清空历史）\n");
askQuestion();
```

### 练习 3：对比不同 Temperature 的效果

写一个脚本，用同一个问题、同一个 system prompt，分别测试 `temperature` 为 `0`、`0.5`、`1.0` 时的输出。

**问题建议**：`"写一首关于月亮的短诗"` 或 `"给我三个创业点子"`

**思考题**：
- Temperature 为 0 时，多运行几次，输出真的一模一样吗？
- 哪个 temperature 的输出你最喜欢？为什么？
- 你认为"事实问答"为什么必须用低 temperature？

---

## 写在最后

你刚才完成的是从"AI 用户"到"AI 开发者"的关键一步。

AI 开发的核心其实不复杂——理解模型是个"补全文字"的机器，理解每次调用是无状态的，理解你要自己管理对话历史。这三件事搞明白了，后面的 RAG、Agent、MCP 都是在这个基础上的延伸。

**下一步**：建议直接跳到 **[03-提示词工程-Prompt-Engineering.md](./03-提示词工程-Prompt-Engineering.md)**，学习怎么写出能稳定控制 AI 输出的 prompt。这是 AI 开发最重要的基本功。

加油！🚀
