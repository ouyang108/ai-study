# Agent 工具调用 — 完整的端到端实战

> 读完你能做出：一个可以调用搜索、计算、执行代码的真正 Agent

---

## 1. 先理解 Agent 工具调用的完整流程

```
用户问："北京现在几度？帮我算一下 (38°C × 2 + 10) / 3 是多少"

Step 1: LLM 分析 → "我需要先查天气，再计算结果"
        ↓
Step 2: LLM 输出 tool_call → { name: "get_weather", args: { city: "北京" } }
        ↓
Step 3: 你的代码执行 get_weather("北京") → { temp: 38, condition: "晴" }
        ↓
Step 4: 把结果返回给 LLM → LLM 分析 → "现在要计算"
        ↓
Step 5: LLM 输出 tool_call → { name: "calculate", args: { expr: "(38*2+10)/3" } }
        ↓
Step 6: 你的代码执行 calculate("(38*2+10)/3") → 28.67
        ↓
Step 7: 把结果返回给 LLM → LLM 生成最终回答
        ↓
输出: "北京现在 38°C，晴。(38×2+10)÷3 = 28.67"
```

**核心理解**：LLM 不执行工具，它只是告诉你"我想调哪个工具、传什么参数"。你的代码才是真正执行工具的人。

---

## 2. 完整项目：多工具 Agent

### 2.1 项目初始化

```bash
mkdir agent-tools-demo && cd agent-tools-demo
npm init -y
npm install openai dotenv
npm install -D typescript tsx @types/node
npx tsc --init
```

### 2.2 定义工具

```typescript
// src/tools.ts — 工具定义 + 真实实现
import OpenAI from "openai";

// ========== 工具类型定义 ==========

/** 工具定义 — 告诉 LLM 有什么工具可用、参数怎么填 */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, {
        type: string;
        description: string;
        enum?: string[];
      }>;
      required: string[];
    };
  };
}

/** LLM 返回的工具调用请求 */
export interface ToolCall {
  id: string;         // 唯一ID，后面返回结果时要匹配
  function: {
    name: string;     // 要调哪个工具
    arguments: string; // JSON字符串，工具参数
  };
}

/** 工具执行结果 */
export interface ToolResult {
  tool_call_id: string;  // 对应 ToolCall 的 id
  content: string;       // 执行结果（字符串）
}

// ========== 工具列表 ==========

/** 所有可用工具的定义（给 LLM 看） */
export const TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "获取指定城市的实时天气。支持中文城市名和英文城市名。",
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "城市名称，如 '北京'、'Shanghai'、'Tokyo'",
          },
        },
        required: ["city"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "搜索互联网获取最新信息。当需要实时信息或模型不确定的事实时使用。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate",
      description: "执行数学计算。支持加减乘除、括号、三角函数等。",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "数学表达式，如 '(38*2+10)/3' 或 'Math.sqrt(144)'",
          },
        },
        required: ["expression"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_current_time",
      description: "获取当前日期和时间。当用户问'现在几点'、'今天几号'时使用。",
      parameters: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description: "时区，如 'Asia/Shanghai'、'America/New_York'，默认 Asia/Shanghai",
          },
        },
        required: [],
      },
    },
  },
];

// ========== 工具的真正实现 ==========

/**
 * 执行具体的工具调用
 * 
 * 这是真正"干活"的地方。LLM 只是告诉你要调哪个工具，
 * 实际逻辑由你在这里实现。
 */
export async function executeTool(toolCall: ToolCall): Promise<ToolResult> {
  const { id, function: fn } = toolCall;
  const args = JSON.parse(fn.arguments);  // LLM 给的参数是 JSON 字符串

  let result: string;

  switch (fn.name) {
    // ===== 天气查询 =====
    case "get_weather": {
      const city = args.city as string;
      // 注意：这里是模拟数据。生产环境替换为真实天气 API
      // 推荐: OpenWeatherMap (https://openweathermap.org/api)
      //       和风天气 (https://dev.qweather.com/)
      const mockWeatherData: Record<string, { temp: number; condition: string; humidity: number }> = {
        "北京": { temp: 38, condition: "晴", humidity: 45 },
        "上海": { temp: 32, condition: "多云", humidity: 70 },
        "广州": { temp: 35, condition: "雷阵雨", humidity: 85 },
        "深圳": { temp: 33, condition: "阴", humidity: 75 },
        "Tokyo": { temp: 28, condition: "小雨", humidity: 80 },
        "New York": { temp: 22, condition: "晴", humidity: 40 },
      };

      const weather = mockWeatherData[city];
      if (weather) {
        result = `${city}: ${weather.temp}°C, ${weather.condition}, 湿度 ${weather.humidity}%`;
      } else {
        result = `${city}: 暂无天气数据（模拟数据仅覆盖北京/上海/广州/深圳/Tokyo/New York）`;
      }
      break;
    }

    // ===== 网络搜索 =====
    case "search_web": {
      const query = args.query as string;
      // 注意：这里是模拟数据。生产环境替换为真实搜索 API
      // 推荐: SerpAPI (https://serpapi.com/)
      //       Brave Search API (https://brave.com/search/api/)
      //       Tavily (https://tavily.com/) — 专为 AI Agent 设计
      //       Exa (https://exa.ai/) — 语义搜索
      result = `搜索结果（模拟）：
1. "${query}" — 根据最新数据显示，相关领域正在快速发展中。
2. 专家建议关注该领域的最新动态和技术突破。
注意：这是模拟搜索结果。生产环境请接入真实搜索 API。`;
      break;
    }

    // ===== 数学计算 =====
    case "calculate": {
      const expression = args.expression as string;
      // 安全警告：生产环境不要用 eval()！
      // 推荐: math.js (https://mathjs.org/) — 安全的数学表达式求值
      //       expr-eval (https://github.com/silentmatt/expr-eval)
      // 这里为了简洁用 eval，但必须验证输入
      try {
        // 基本安全检查：只允许数字、运算符、Math函数、括号、空格
        if (!/^[\d\s+\-*/().,%Math.sqrtMath.powersincostanlog]+$/.test(expression)) {
          result = `错误：表达式包含不允许的字符`;
        } else {
          // 用 Function 替代 eval，稍微安全一些（限制作用域）
          const calculated = new Function(`return (${expression})`)();
          result = `${expression} = ${calculated}`;
        }
      } catch (err) {
        result = `计算错误：${(err as Error).message}`;
      }
      break;
    }

    // ===== 当前时间 =====
    case "get_current_time": {
      const timezone = (args.timezone as string) || "Asia/Shanghai";
      const now = new Date().toLocaleString("zh-CN", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        weekday: "long",
      });
      result = `${timezone} 当前时间: ${now}`;
      break;
    }

    default:
      result = `错误：未知工具 '${fn.name}'`;
  }

  return {
    tool_call_id: id,
    content: result,
  };
}
```

### 2.3 Agent 核心循环

```typescript
// src/agent.ts — Agent 的主循环
import OpenAI from "openai";
import "dotenv/config";
import { TOOLS, executeTool, type ToolCall, type ToolResult } from "./tools";

// ========== Agent 配置 ==========

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // 用 DeepSeek 学更便宜，取消注释下面这行：
  // baseURL: "https://api.deepseek.com/v1",
});

const AGENT_SYSTEM_PROMPT = `你是一个智能助手 Agent，可以调用工具来完成任务。

## 工具使用规则
1. 当需要实时信息、计算、或不确定的事实时，调用对应工具
2. 每次只调用一个工具（不要一次调用多个）
3. 拿到工具结果后，判断是否需要继续调用其他工具
4. 如果信息足够回答问题，直接给出最终答案
5. 如果工具调用失败，告诉用户失败原因，尝试其他方法

## 输出规则
- 回答要简洁
- 涉及计算时，先展示公式再展示结果
- 涉及搜索时，引用搜索结果的要点
- 不重要的小计算可以心算，不用调工具`;

// ========== Agent 核心循环 ==========

const MAX_TURNS = 10;  // 最多 10 轮（防止死循环烧钱）

interface AgentResponse {
  answer: string;
  turns: number;
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }>;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

async function runAgent(userMessage: string): Promise<AgentResponse> {
  // 消息历史：从 system prompt + 用户第一条消息开始
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  const toolCallLog: AgentResponse["toolCalls"] = [];
  let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  // —— Agent 循环 ——
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    console.log(`\n🔄 第 ${turn + 1} 轮...`);

    // Step 1: 调用 LLM
    const response = await client.chat.completions.create({
      model: process.env.AGENT_MODEL || "gpt-4o",  // 用环境变量控制模型
      messages,
      tools: TOOLS,
      tool_choice: "auto",  // LLM 自主决定是否调工具
      temperature: 0,       // Agent 用低温度保证一致行为
    });

    const choice = response.choices[0];
    const { message } = choice;

    // 统计 token 消耗
    if (response.usage) {
      totalUsage.promptTokens += response.usage.prompt_tokens;
      totalUsage.completionTokens += response.usage.completion_tokens;
      totalUsage.totalTokens += response.usage.total_tokens;
    }

    // Step 2: 判断 LLM 是要调工具还是直接回答
    if (message.tool_calls && message.tool_calls.length > 0) {
      // —— 情况A: LLM 要调用工具 ——
      const toolCall = message.tool_calls[0] as unknown as ToolCall;
      const fnName = toolCall.function.name;
      const fnArgs = JSON.parse(toolCall.function.arguments);

      console.log(`  🔧 调用工具: ${fnName}(${JSON.stringify(fnArgs)})`);

      // 执行工具
      const toolResult = await executeTool(toolCall);
      console.log(`  ✅ 工具返回: ${toolResult.content.slice(0, 100)}`);

      // 记录调用日志
      toolCallLog.push({
        name: fnName,
        args: fnArgs as Record<string, unknown>,
        result: toolResult.content,
      });

      // 把 LLM 的 tool_call 消息 + 工具结果都加入上下文
      messages.push({
        role: "assistant",
        tool_calls: [
          {
            id: toolCall.id,
            type: "function",
            function: {
              name: fnName,
              arguments: toolCall.function.arguments,
            },
          },
        ],
      });
      messages.push({
        role: "tool",
        tool_call_id: toolResult.tool_call_id,
        content: toolResult.content,
      });

      // 继续循环，让 LLM 根据工具结果决定下一步
      continue;
    }

    // —— 情况B: LLM 直接回答（没有要调用的工具） ——
    const answer = message.content || "（LLM 未生成回复）";
    console.log(`  💬 最终回答: ${answer.slice(0, 100)}...`);

    return {
      answer,
      turns: turn + 1,
      toolCalls: toolCallLog,
      usage: totalUsage,
    };
  }

  // 到这里的唯一可能：MAX_TURNS 耗尽
  return {
    answer: "抱歉，处理超时。任务可能太复杂，请简化问题后重试。",
    turns: MAX_TURNS,
    toolCalls: toolCallLog,
    usage: totalUsage,
  };
}

export { runAgent };
```

### 2.4 CLI 入口

```typescript
// src/index.ts — 命令行交互入口
import * as readline from "readline";
import { runAgent } from "./agent";

// 交互式 CLI
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "\n👤 你: ",
});

console.log("=" .repeat(60));
console.log("🤖 AI Agent 工具调用演示");
console.log("=" .repeat(60));
console.log("可用能力：查询天气 | 网络搜索 | 数学计算 | 查看时间");
console.log("输入 'quit' 或 'exit' 退出\n");

rl.prompt();

rl.on("line", async (line) => {
  const input = line.trim();
  if (!input || input === "quit" || input === "exit") {
    console.log("👋 再见！");
    rl.close();
    return;
  }

  try {
    const result = await runAgent(input);

    console.log(`\n🤖 AI: ${result.answer}`);
    console.log(`\n📊 统计: ${result.turns} 轮, ` +
      `${result.toolCalls.length} 次工具调用, ` +
      `${result.usage.totalTokens} tokens`);
    if (result.toolCalls.length > 0) {
      console.log("🔧 工具调用记录:");
      result.toolCalls.forEach((tc, i) => {
        console.log(`  ${i + 1}. ${tc.name}(${JSON.stringify(tc.args)})`);
      });
    }
  } catch (err) {
    console.error("❌ 错误:", (err as Error).message);
  }

  rl.prompt();
});

rl.on("close", () => process.exit(0));
```

### 2.5 运行

```bash
# .env 文件
OPENAI_API_KEY=sk-your-key-here
AGENT_MODEL=gpt-4o  # 可选，默认 gpt-4o

# 运行
npx tsx src/index.ts
```

### 2.6 测试用例

```
👤 你: 北京今天天气怎么样？

🔄 第 1 轮...
  🔧 调用工具: get_weather({"city":"北京"})
  ✅ 工具返回: 北京: 38°C, 晴, 湿度 45%
🔄 第 2 轮...
  💬 最终回答: 北京今天晴天，气温38°C，湿度45%，非常炎热，注意防暑

🤖 AI: 北京今天晴天，气温38°C，湿度45%，非常炎热，注意防暑

📊 统计: 2 轮, 1 次工具调用, 485 tokens

--- 分割线 ---

👤 你: (38°C × 2 + 10) ÷ 3 等于多少？

🔄 第 1 轮...
  🔧 调用工具: calculate({"expression":"(38*2+10)/3"})
  ✅ 工具返回: (38*2+10)/3 = 28.666666666666668
🔄 第 2 轮...
  💬 最终回答: (38×2+10)÷3 ≈ 28.67

---

👤 你: 查一下今年AI领域最大的新闻

🔄 第 1 轮...
  🔧 调用工具: search_web({"query":"2026年AI领域重大新闻"})
  ✅ 工具返回: 搜索结果（模拟）...
🔄 第 2 轮...
  💬 最终回答: 根据搜索结果，AI领域正在快速发展中...

---

👤 你: 北京和上海哪个热？

🔄 第 1 轮...
  🔧 调用工具: get_weather({"city":"北京"})
  ✅ 工具返回: 北京: 38°C, 晴...
🔄 第 2 轮...
  🔧 调用工具: get_weather({"city":"上海"})
  ✅ 工具返回: 上海: 32°C, 多云...
🔄 第 3 轮...
  💬 最终回答: 北京38°C比上海32°C热6度，北京更热
```

---

## 3. 进阶：接入真实 API

上面用的是模拟数据。下面把关键工具替换成真实 API：

### 3.1 真实天气（和风天气）

```typescript
// src/tools-real.ts — 接入真实 API 的版本

// 和风天气: https://dev.qweather.com/
// 免费版每天 1000 次调用，够学习和开发用了
async function getRealWeather(city: string): Promise<string> {
  const QWEATHER_KEY = process.env.QWEATHER_API_KEY!;

  // Step 1: 城市搜索（获取 location ID）
  const cityRes = await fetch(
    `https://geoapi.qweather.com/v2/city/lookup?location=${encodeURIComponent(city)}&key=${QWEATHER_KEY}`
  );
  const cityData = await cityRes.json();
  const locationId = cityData.location?.[0]?.id;
  if (!locationId) return `未找到城市"${city}"`;

  // Step 2: 获取实时天气
  const weatherRes = await fetch(
    `https://devapi.qweather.com/v7/weather/now?location=${locationId}&key=${QWEATHER_KEY}`
  );
  const weatherData = await weatherRes.json();
  const now = weatherData.now;

  return `${city}: ${now.temp}°C, ${now.text}, 体感${now.feelsLike}°C, 湿度${now.humidity}%, ${now.windDir}风${now.windScale}级`;
}
```

### 3.2 真实搜索（Tavily — 专为 Agent 设计）

```typescript
// Tavily: https://tavily.com/
// 专为 AI Agent 优化的搜索 API，返回干净的结构化结果
async function realWebSearch(query: string): Promise<string> {
  const TAVILY_KEY = process.env.TAVILY_API_KEY!;

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_KEY,
      query,
      search_depth: "basic",  // basic(快)/advanced(全但慢)
      max_results: 5,
    }),
  });

  const data = await res.json();
  return data.results
    .map((r: { title: string; content: string; url: string }, i: number) =>
      `${i + 1}. ${r.title}\n   ${r.content.slice(0, 200)}\n   来源: ${r.url}`)
    .join("\n\n");
}
```

### 3.3 真实数学计算（math.js 安全替代 eval）

```typescript
// math.js: https://mathjs.org/
// npm install mathjs
import { evaluate } from "mathjs";

function safeCalculate(expression: string): string {
  try {
    const result = evaluate(expression);
    return `${expression} = ${result}`;
  } catch (err) {
    return `计算错误: ${(err as Error).message}`;
  }
}
```

---

## 4. Agent 工具调用的关键坑

### 坑1: LLM "编造"工具参数

```
问题: LLM 传了一个不存在的城市名 → API 返回错误 → LLM 以为"今天没天气数据"
解决: 工具返回错误时明确说"城市不存在"，让 LLM 让用户澄清
```

### 坑2: Agent 循环调用同一个工具

```
问题: 搜索第一次没找到 → LLM 换个关键词再搜 → 还是没找到 → 无限循环
解决: 设置 MAX_TURNS 和工具调用次数上限；检测到 3 次相同工具调用后强制终止
```

### 坑3: 参数格式不对

```
问题: LLM 把 calculate 的参数写成了 { "expr": "1+1" } 而不是 { "expression": "1+1" }
解决: 工具 description 和参数名要非常明确；工具实现做容错处理
```

### 坑4: 工具返回太长污染上下文

```
问题: 搜索结果返回了 5000 字 → 塞进上下文 → 对话很快超出限制
解决: 每个工具结果限制在 500 字以内；把详细信息存到外部，只给 LLM 看摘要
```

```typescript
// 工具结果长度限制
function truncateToolResult(result: string, maxLen: number = 500): string {
  if (result.length <= maxLen) return result;
  return result.slice(0, maxLen) + `\n...（结果过长，已截断。剩余 ${result.length - maxLen} 字符未展示）`;
}
```

---

## 5. 扩展方向

当前是单次对话 Agent。你可以继续扩展：

| 方向 | 做什么 |
|------|--------|
| **多轮记忆** | 把 `AgentWorkingMemory`（参考 18-高级技巧）集成进来 |
| **多工具并行** | 把天气查询和计算同时执行（`Promise.all`） |
| **人在回路** | 花钱/发邮件/删数据之前弹出确认（参考 15-数据与架构 §5.5） |
| **MCP 协议** | 把工具改为 MCP Server 标准接口（参考 02-MCP） |
| **Web 界面** | 用 Express + SSE 做一个浏览器版 Agent |
| **LangGraph 版** | 用 `@langchain/langgraph` 把 Agent 改造成带状态的图（更复杂的任务） |

---

## 6. 相关文档

- [01-AI Agent](./01-AI智能体-AI-Agent.md) — Agent 架构理论
- [02-MCP](./02-MCP协议-Model-Context-Protocol.md) — MCP 协议标准工具接口
- [04-Skills](./04-技能系统-Skills.md) — 技能系统设计
- [18-高级技巧](./18-高级实战技巧-Advanced-Techniques.md) — Agent Working Memory
- [15-数据与架构 §5.3](./15-数据与架构-Data-Architecture.md) — Agent 编排模式
