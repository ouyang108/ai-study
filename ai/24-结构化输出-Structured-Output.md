# 结构化输出（Structured Output）

> 读完你能做到：让任意 LLM 稳定返回带类型校验的结构化数据，出错自动重试

---

## 1. 为什么需要结构化输出

### 1.1 "请用 JSON 格式返回" 为什么不靠谱

你在提示词里写了"请以 JSON 格式输出"，但 LLM 可能会：

```typescript
// ❌ 你不知道拿到的到底是什么：

// 情况1：多了一层解释文字
// "好的，以下是JSON格式的结果：\n{ \"name\": \"张三\" }"

// 情况2：字段名拼写不一致（英文/中文混用）
// { "姓名": "张三", "nianling": 25 }   ← 你期望的是 { "name": "张三", "age": 25 }

// 情况3：类型不对
// { "age": "二十五" }  ← 你期望 age 是 number

// 情况4：JSON 本身不合法
// { "name": "张三", "hobbies": ["读书", "运动",] }  ← 尾部多余逗号

// 情况5：多了一层不必要的嵌套
// { "data": { "result": { "name": "张三" } } }

// 情况6：直接返回纯文本
// "这个人的名字是张三"
```

这些在生产环境中是致命的——下游代码（数据库写入、API 响应、前端渲染）必须依赖确定性的数据格式。

### 1.2 生产环境的真实需求

```
你的代码                       LLM
┌──────────┐                ┌────────┐
│ 解析结果  │  ←───────────  │ 模型输出 │
│          │                │        │
│ 如果这里 │   一场灾难      │ 什么都  │
│ 崩了...  │                │ 可能返回 │
└──────────┘                └────────┘
```

你需要的是：**类型安全、字段名确定、值类型正确、解析失败能自动修复**。

### 1.3 三种方案对比

| 方案 | 原理 | 可靠性 | 模型支持 | 灵活性 |
|------|------|--------|----------|--------|
| **提示词约束** | 在提示词里写"请返回JSON" | 低（50-80%） | 所有模型 | 最高 |
| **JSON Mode** | 通过API参数强制JSON输出 | 中（90%+） | OpenAI/部分模型 | 中 |
| **Structured Output** | 通过API给定JSON Schema | 高（99%+） | OpenAI gpt-4o等 | 低 |
| **Zod + 重试** | 解析失败时把错误反馈给LLM | 高（99%+） | 所有模型 | 最高 |
| **Tool Calling** | 利用function calling机制 | 高（95%+） | 主流模型都支持 | 高 |

本文会逐一讲解，最后给出推荐方案。

---

## 2. 方案A: OpenAI JSON Mode

### 2.1 原理

OpenAI 在 API 层面强制 LLM 输出合法 JSON，通过 `response_format: { type: "json_object" }` 开启。

```typescript
// src/json-mode-basic.ts
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ========== JSON Mode 基础用法 ==========

async function extractPersonInfo(text: string): Promise<Record<string, unknown>> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        // ⚠️ 关键约束：system prompt 中必须包含 "JSON" 这个单词
        // 否则 API 会返回错误，这是 JSON Mode 的硬性要求
        content: `你是一个信息提取助手。请从文本中提取人物信息，以 JSON 格式返回。`,
      },
      { role: "user", content: text },
    ],
    response_format: { type: "json_object" }, // 开启 JSON Mode
    temperature: 0.1, // 低温度提高稳定性
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("LLM 返回了空内容");

  // JSON Mode 保证返回的是合法 JSON，但不保证结构正确
  return JSON.parse(content);
}

// ========== 测试 ==========
async function main() {
  const result = await extractPersonInfo("张三，28岁，软件工程师，base在北京");
  console.log("提取结果:", JSON.stringify(result, null, 2));
  // 可能输出：{ "name": "张三", "age": 28, "job": "软件工程师", "city": "北京" }
  // 也可能输出：{ "姓名": "张三", "年龄": 28, "职业": "软件工程师" }
  // ↑ 字段名不可控！
}

main().catch(console.error);
```

### 2.2 JSON Mode 的优缺点

```typescript
// ========== JSON Mode 优缺点详解 ==========

/**
 * 优点：
 * 1. 保证输出是合法 JSON（不会出现纯文本、Markdown包裹等）
 * 2. 使用简单，一个参数搞定
 * 3. 不占用额外 token（不像 tool calling 需要额外的 schema 描述）
 *
 * 缺点：
 * 1. 必须有 "JSON" 关键字在 system prompt 中
 * 2. 只保证是 JSON，不保证字段名、类型正确
 * 3. 只支持对象（{...}），不支持数组（[...]）顶层
 * 4. 仅 OpenAI API 支持
 * 5. 不能约束具体字段
 */
```

**结论**：JSON Mode 比纯提示词靠谱，但还不够。生产环境需要更强的保证。

---

## 3. 方案B: Structured Output（OpenAI 最新）

### 3.1 原理

OpenAI 于 2024 年推出的 Structured Output 功能，允许传入 JSON Schema，LLM 的输出 **严格遵循** 该 Schema——字段名、类型、必填字段全部保证。

```typescript
// src/structured-output-openai.ts
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ========== 定义响应 Schema ==========

// OpenAI 的 json_schema 格式要求
const personSchema = {
  name: "person", // Schema 名称（必须）
  strict: true,   // 严格模式（开启后必须遵循 schema）
  schema: {
    type: "object" as const,
    properties: {
      name: {
        type: "string",
        description: "人物姓名",
      },
      age: {
        type: "number",
        description: "人物年龄",
      },
      occupation: {
        type: "string",
        description: "职业",
      },
      skills: {
        type: "array",
        description: "技能列表",
        items: {
          type: "string",
        },
      },
    },
    // 指定必填字段，LLM 保证一定返回这些字段
    required: ["name", "age", "occupation", "skills"],
    // 不允许额外字段（strict: true 时自动生效）
    additionalProperties: false,
  },
};

// ========== Structured Output 调用 ==========

async function extractPersonStructured(
  text: string
): Promise<{
  name: string;
  age: number;
  occupation: string;
  skills: string[];
}> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o", // 需要 gpt-4o 或更新模型
    messages: [
      {
        role: "system",
        content: "你是一个信息提取助手。请从文本中提取人物信息。",
      },
      { role: "user", content: text },
    ],
    response_format: {
      type: "json_schema",
      json_schema: personSchema,
    },
    temperature: 0.1,
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("LLM 返回了空内容");

  // 此时可以信任 JSON.parse 的结果与 schema 一致
  const parsed = JSON.parse(content);

  // ⚠️ 即使有 Structured Output，建议仍做一层校验（防守编程）
  if (typeof parsed.name !== "string") throw new Error("name 字段类型错误");
  if (typeof parsed.age !== "number") throw new Error("age 字段类型错误");
  if (typeof parsed.occupation !== "string")
    throw new Error("occupation 字段类型错误");
  if (!Array.isArray(parsed.skills)) throw new Error("skills 字段类型错误");

  return parsed as {
    name: string;
    age: number;
    occupation: string;
    skills: string[];
  };
}

// ========== 测试 ==========
async function main() {
  const result = await extractPersonStructured(
    "李四，35岁，全栈工程师，擅长React、Node.js、AWS"
  );
  console.log("结构化提取结果:", JSON.stringify(result, null, 2));
  // 保证输出：
  // {
  //   "name": "李四",
  //   "age": 35,
  //   "occupation": "全栈工程师",
  //   "skills": ["React", "Node.js", "AWS"]
  // }
}

main().catch(console.error);
```

### 3.2 支持 Structured Output 的模型

```typescript
// ========== 模型支持情况 ==========

/**
 * ✅ 支持 structured output 的 OpenAI 模型：
 * - gpt-4o / gpt-4o-mini
 * - gpt-4-0613 及以上
 * - gpt-4-turbo
 * - o1 / o3-mini（部分支持）
 *
 * ❌ 不支持的模型：
 * - gpt-3.5-turbo
 * - 其他厂商的模型（Claude、Gemini 等，需用别的方案）
 */
```

### 3.3 Structured Output 的局限性

```typescript
// ========== 常见限制 ==========

/**
 * 1. strict: true 模式下的限制：
 *    - 所有字段必须在 required 中列出
 *    - 不支持 enum（需要用 string + description 替代）
 *    - 不支持 oneOf / anyOf / allOf
 *    - 不支持嵌套的 $ref 引用
 *    - 嵌套深度不超过 5 层
 *
 * 2. 平台限制：
 *    - 仅 OpenAI API 支持
 *    - 不支持 streaming 模式（会等全部生成完才返回）
 *    - 部分参数受限（如不支持 parallel_tool_calls）
 *
 * 3. 额外 token 消耗：
 *    - Schema 本身会占用一定 token
 */
```

**结论**：Structured Output 是最可靠的方案，但仅限 OpenAI 生态，且 Schema 定义有诸多限制。

---

## 4. 方案C: Zod 验证 + 自动重试（通用方案，推荐）

### 4.1 核心思路

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ 请求 LLM  │ → │ 解析 JSON │ → │ Zod 校验  │ → │ 成功返回  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                     │                │
                     │  失败           │  校验失败
                     ↓                ↓
               ┌──────────────────────────────┐
               │ 把错误信息反馈给 LLM           │
               │ "你上次返回的 age 是 string，  │
               │  应该是 number，请修正"        │
               └──────────────────────────────┘
                     │
                     ↓ 重试（最多3次）
               ┌──────────┐
               │ 重新请求   │
               └──────────┘
```

这个方案的优势是：**任何模型都能用、字段完全可控、出错自动修复**。

### 4.2 项目初始化

```bash
mkdir structured-output-demo && cd structured-output-demo
npm init -y
npm install openai zod dotenv
npm install -D typescript tsx @types/node
npx tsc --init --target ES2022 --module NodeNext --moduleResolution NodeNext
```

### 4.3 核心函数：structuredChat\<T\>()

```typescript
// src/structured-chat.ts — 通用结构化聊天函数
import { z, ZodType, ZodError } from "zod";

// ========== 类型定义 ==========

/** 支持的消息格式 */
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 结构化聊天的配置选项 */
interface StructuredChatOptions<T extends ZodType> {
  /** 模型名称，如 "gpt-4o"、"claude-3.5-sonnet" 等 */
  model: string;
  /** 消息列表 */
  messages: ChatMessage[];
  /** Zod schema，用于校验输出 */
  schema: T;
  /** 最大重试次数（默认 3） */
  maxRetries?: number;
  /** 温度参数（默认 0.1） */
  temperature?: number;
  /** 自定义提取函数（可选，默认用 JSON 提取） */
  extractJson?: (raw: string) => string;
  /** 自定义调用 LLM 的函数（传入此参数以支持任意模型） */
  callLLM?: (messages: ChatMessage[]) => Promise<string>;
}

/** 结构化聊天的返回结果 */
interface StructuredChatResult<T> {
  data: T;
  attempts: number;
  history: Array<{ raw: string; parsed: unknown; error?: string }>;
}

// ========== JSON 提取工具 ==========

/**
 * 从 LLM 的原始输出中提取 JSON 字符串
 * LLM 可能返回 Markdown 代码块包裹的 JSON，或纯文本 + JSON 混合
 */
function extractJsonFromText(raw: string): string {
  // 情况1：```json ... ``` 代码块
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  // 情况2：``` ... ``` 无语言标记
  const genericBlockMatch = raw.match(/```\s*([\s\S]*?)```/);
  if (genericBlockMatch) return genericBlockMatch[1].trim();

  // 情况3：直接查找 { 到 } 的 JSON 对象
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }

  // 情况4：查找 [ 到 ] 的 JSON 数组
  const firstBracket = raw.indexOf("[");
  const lastBracket = raw.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    return raw.slice(firstBracket, lastBracket + 1);
  }

  // 兜底：返回原文（让后续 parse 失败时触发重试）
  return raw;
}

// ========== 默认的 LLM 调用实现（OpenAI 兼容） ==========

/**
 * 默认的 LLM 调用函数（OpenAI 协议兼容）
 * 如果你的模型支持 OpenAI 兼容 API，可以直接使用
 */
async function defaultCallLLM(
  model: string,
  messages: ChatMessage[]
): Promise<string> {
  // 动态导入 openai，避免未安装时报错
  let OpenAI: any;
  try {
    OpenAI = (await import("openai")).default;
  } catch {
    throw new Error(
      "使用默认 callLLM 需要安装 openai 包: npm install openai"
    );
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: 0.1,
  });

  return response.choices[0].message.content || "";
}

// ========== Zod 错误信息格式化 ==========

/**
 * 将 ZodError 格式化为 LLM 能理解的自然语言
 * 这样 LLM 就能根据错误信息自我修正
 */
function formatZodErrors(error: ZodError): string {
  const issues = error.issues.map((issue, index) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(根对象)";
    const expected = issue.expected || "未知";
    const received = issue.received || "未知";
    const message = issue.message;

    return [
      `  错误 ${index + 1}: 字段路径="${path}"`,
      `    期望类型: ${expected}`,
      `    实际类型: ${received}`,
      `    详细描述: ${message}`,
    ].join("\n");
  });

  return `JSON 校验失败，请根据以下错误修正你的输出：\n${issues.join("\n")}`;
}

// ========== 核心函数 ==========

/**
 * 结构化聊天 — 通用重试方案
 *
 * 用任意 LLM 生成结构化数据，通过 Zod Schema 校验，
 * 校验失败时自动将错误反馈给 LLM 重试，最多重试 maxRetries 次。
 *
 * @example
 * ```typescript
 * const schema = z.object({
 *   name: z.string(),
 *   age: z.number(),
 *   tags: z.array(z.string())
 * });
 *
 * const result = await structuredChat({
 *   model: "gpt-4o",
 *   messages: [{ role: "user", content: "张三，28岁，标签：工程师、跑步" }],
 *   schema,
 * });
 *
 * // result.data 的类型自动推导为 { name: string; age: number; tags: string[] }
 * console.log(result.data.name); // 张三
 * ```
 */
async function structuredChat<T extends ZodType>(
  options: StructuredChatOptions<T>
): Promise<StructuredChatResult<z.infer<T>>> {
  const {
    model,
    messages,
    schema,
    maxRetries = 3,
    temperature = 0.1,
    extractJson = extractJsonFromText,
    callLLM,
  } = options;

  // 如果没有提供自定义 callLLM，使用默认的 OpenAI 实现
  const callModel = callLLM || ((msgs: ChatMessage[]) => defaultCallLLM(model, msgs));

  // 构建包含 Schema 要求的系统提示词
  const schemaDescription = describeZodSchema(schema);
  const systemPrompt: ChatMessage = {
    role: "system",
    content: [
      "你是一个数据提取助手。你需要从用户输入中提取信息，并以 JSON 格式返回。",
      "",
      "要求：",
      "1. 只返回纯 JSON，不要用 Markdown 代码块包裹，不要添加任何解释文字",
      "2. JSON 必须符合以下 Schema：",
      schemaDescription,
      "",
      "重要：如果信息缺失，请用合理的默认值（如空字符串、0、空数组）填充，",
      "而不要省略字段。",
    ].join("\n"),
  };

  // 将系统提示词放到 messages 的最前面
  const baseMessages = [systemPrompt, ...messages];

  // 执行历史记录（便于调试）
  const history: Array<{ raw: string; parsed: unknown; error?: string }> = [];

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      // 调用 LLM
      const raw = await callModel(baseMessages);
      console.log(`[尝试 ${attempt}/${maxRetries + 1}] LLM 原始输出:`,
        raw.slice(0, 200) + (raw.length > 200 ? "..." : ""));

      // 提取 JSON
      const jsonStr = extractJson(raw);

      // 解析 JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (parseError: any) {
        // JSON 解析失败：把错误反馈给 LLM，继续重试
        const errorMsg = `你返回的内容不是合法的 JSON。解析错误：${parseError.message}。原始输出：${raw.slice(0, 300)}。请只返回纯 JSON，不要包含任何其他文字。`;

        history.push({ raw, parsed: null, error: parseError.message });

        if (attempt <= maxRetries) {
          baseMessages.push({ role: "assistant", content: raw });
          baseMessages.push({ role: "user", content: errorMsg });
        }
        continue;
      }

      // Zod 校验
      const validationResult = schema.safeParse(parsed);

      if (validationResult.success) {
        // ✅ 校验通过，返回结果
        history.push({ raw, parsed });
        return {
          data: validationResult.data as z.infer<T>,
          attempts: attempt,
          history,
        };
      } else {
        // ❌ 校验失败：把错误反馈给 LLM
        const zodErrorMessage = formatZodErrors(validationResult.error);
        const retryPrompt = [
          zodErrorMessage,
          "",
          "请修正后重新返回完整的 JSON。确保：",
          "1. 所有必填字段都存在",
          "2. 所有字段的类型正确",
          "3. 字段名与 Schema 中的名称严格一致",
        ].join("\n");

        history.push({
          raw,
          parsed,
          error: validationResult.error.message,
        });

        if (attempt <= maxRetries) {
          baseMessages.push({ role: "assistant", content: raw });
          baseMessages.push({ role: "user", content: retryPrompt });
        }
      }
    } catch (error: any) {
      // 网络错误等不可恢复的错误：直接抛出
      throw new Error(
        `调用 LLM 失败 (尝试 ${attempt}/${maxRetries + 1}): ${error.message}`
      );
    }
  }

  // 所有重试都用完了还是失败
  throw new Error(
    `结构化输出失败，已重试 ${maxRetries} 次。最后的历史记录：\n` +
      history
        .map(
          (h, i) =>
            `[尝试 ${i + 1}] 错误: ${h.error}\n原始输出: ${h.raw.slice(0, 200)}`
        )
        .join("\n\n")
  );
}

/**
 * 将 Zod Schema 转换为人类可读的描述文字
 * 这段文字会被放入 system prompt 中，指导 LLM 按正确格式输出
 */
function describeZodSchema(schema: ZodType): string {
  // 处理 ZodObject
  if (schema instanceof z.ZodObject) {
    const shape = (schema as any)._def.shape();
    const lines: string[] = ["{"];
    for (const [key, field] of Object.entries(shape) as [string, any][]) {
      const type = describeZodField(field);
      const optional = schema.shape[key] instanceof z.ZodOptional ? " (可选)" : "";
      const def = field._def?.defaultValue;
      const defaultStr =
        def !== undefined && def !== null ? ` (默认值: ${JSON.stringify(def)})` : "";
      lines.push(`  "${key}": ${type}${optional}${defaultStr}`);
    }
    lines.push("}");
    return lines.join("\n");
  }

  // 处理 ZodArray
  if (schema instanceof z.ZodArray) {
    return `[${describeZodSchema(schema.element)}]`;
  }

  // 处理 ZodEnum
  if (schema instanceof z.ZodEnum) {
    const values = Object.values(schema.Values);
    return values.map((v) => `"${v}"`).join(" | ");
  }

  // 处理带 .describe() 的 schema
  if (schema._def?.description) {
    return schema._def.description;
  }

  // 简单类型
  const typeMap: Record<string, string> = {
    ZodString: "字符串",
    ZodNumber: "数字",
    ZodBoolean: "布尔值",
    ZodArray: "数组",
    ZodObject: "对象",
    ZodEnum: "枚举值",
    ZodOptional: "可选",
    ZodNullable: "可为null",
    ZodDate: "日期字符串 (ISO 8601)",
  };

  const typeName = schema._def?.typeName || "unknown";
  return typeMap[typeName] || typeName;
}

/** 描述单个字段的类型 */
function describeZodField(field: any): string {
  if (field instanceof z.ZodObject) {
    return describeZodSchema(field);
  }
  if (field instanceof z.ZodArray) {
    return `[${describeZodSchema(field.element)}]`;
  }
  if (field instanceof z.ZodEnum) {
    const values = Object.values(field.Values);
    return values.map((v) => `"${v}"`).join(" | ");
  }
  if (field instanceof z.ZodOptional || field instanceof z.ZodNullable) {
    return describeZodField(field._def?.innerType || field.unwrap());
  }
  if (field._def?.description) {
    return field._def.description;
  }

  const typeMap: Record<string, string> = {
    ZodString: "字符串",
    ZodNumber: "数字",
    ZodBoolean: "布尔值",
    ZodDate: "日期 (ISO 8601)",
  };
  return typeMap[field._def?.typeName] || "字符串";
}

// ========== 导出 ==========
export { structuredChat };
export type { StructuredChatOptions, StructuredChatResult, ChatMessage };
```

### 4.4 用法示例

```typescript
// src/demo-structured-chat.ts — 结构化聊天的使用示例
import { z } from "zod";
import { structuredChat } from "./structured-chat.js";

// ========== 示例1：情感分析 ==========

async function sentimentAnalysisExample() {
  // 定义期望的输出结构
  const sentimentSchema = z.object({
    sentiment: z.enum(["positive", "negative", "neutral"]).describe(
      "情感倾向：正面、负面或中性"
    ),
    confidence: z.number().min(0).max(1).describe(
      "置信度，0到1之间的小数"
    ),
    keywords: z.array(z.string()).describe("影响情感判断的关键词列表"),
    reasoning: z.string().describe("判断理由，简短说明"),
  });

  const result = await structuredChat({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content:
          "这款产品真的超出了我的预期！物流很快，包装精美，用起来手感特别好。强烈推荐！",
      },
    ],
    schema: sentimentSchema,
    maxRetries: 3,
  });

  console.log("✅ 情感分析结果:");
  console.log(`  情感: ${result.data.sentiment}`);
  console.log(`  置信度: ${(result.data.confidence * 100).toFixed(1)}%`);
  console.log(`  关键词: ${result.data.keywords.join(", ")}`);
  console.log(`  理由: ${result.data.reasoning}`);
  console.log(`  共尝试 ${result.attempts} 次`);

  // result.data 的类型自动推导：
  // { sentiment: "positive"|"negative"|"neutral"; confidence: number; keywords: string[]; reasoning: string }
}

// ========== 示例2：嵌套对象 ==========

async function personInfoExample() {
  const personSchema = z.object({
    name: z.string().describe("人名"),
    age: z.number().describe("年龄"),
    contact: z.object({
      email: z.string().email().describe("邮箱地址"),
      phone: z.string().optional().describe("电话号码（可选）"),
    }),
    skills: z.array(z.string()).describe("技能列表"),
  });

  const result = await structuredChat({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: "王小明, 26岁, 前端工程师, 邮箱xiaoming@example.com, 电话138xxxx, 会React和Vue",
      },
    ],
    schema: personSchema,
  });

  console.log("\n✅ 人物信息提取:");
  console.log(`  姓名: ${result.data.name}`);
  console.log(`  年龄: ${result.data.age}`);
  console.log(`  邮箱: ${result.data.contact.email}`);
  console.log(`  技能: ${result.data.skills.join(", ")}`);
}

// ========== 运行 ==========
async function main() {
  await sentimentAnalysisExample();
  await personInfoExample();
}

main().catch(console.error);
```

### 4.5 自定义 LLM 适配（支持 Claude / Gemini / 本地模型）

```typescript
// src/custom-llm-adapter.ts — 适配任意 LLM 的示例
import { z } from "zod";
import { structuredChat, ChatMessage } from "./structured-chat.js";

// ========== 适配 Anthropic Claude ==========

async function claudeAdapter() {
  // 需要先安装: npm install @anthropic-ai/sdk
  let Anthropic: any;
  try {
    Anthropic = (await import("@anthropic-ai/sdk")).default;
  } catch {
    throw new Error("请先安装: npm install @anthropic-ai/sdk");
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // 自定义 callLLM 函数，适配 Claude 的 API
  async function callClaude(messages: ChatMessage[]): Promise<string> {
    // 提取 system prompt（Claude 的 system 是单独参数）
    const systemMsg = messages.find((m) => m.role === "system");
    const otherMsgs = messages.filter((m) => m.role !== "system");

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemMsg?.content,
      messages: otherMsgs.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    // Claude 返回的是 TextBlock 数组，取第一个文本块
    return response.content[0].text;
  }

  const schema = z.object({
    summary: z.string(),
    score: z.number().min(0).max(100),
  });

  const result = await structuredChat({
    model: "claude-sonnet-4-20250514",
    messages: [
      {
        role: "user",
        content: "请评价这篇文章的质量，给出摘要和评分",
      },
    ],
    schema,
    callLLM: callClaude, // 传入自定义的 LLM 调用函数
  });

  console.log("Claude 返回:", result.data);
}

// ========== 适配 Ollama 本地模型 ==========

async function ollamaAdapter() {
  // Ollama 提供 OpenAI 兼容 API，修改 baseURL 即可
  let OpenAI: any;
  try {
    OpenAI = (await import("openai")).default;
  } catch {
    throw new Error("请先安装: npm install openai");
  }

  const ollama = new OpenAI({
    baseURL: "http://localhost:11434/v1",
    apiKey: "ollama", // Ollama 不需要真实 API Key，但必须填一个值
  });

  async function callOllama(messages: ChatMessage[]): Promise<string> {
    const response = await ollama.chat.completions.create({
      model: "qwen2.5:7b",
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: 0.1,
    });
    return response.choices[0].message.content || "";
  }

  const schema = z.object({
    answer: z.string(),
    confidence: z.number(),
  });

  const result = await structuredChat({
    model: "qwen2.5:7b",
    messages: [{ role: "user", content: "1+1等于几？" }],
    schema,
    callLLM: callOllama,
    maxRetries: 2, // 本地模型可能不太稳定，多给几次机会
  });

  console.log("Ollama 本地模型返回:", result.data);
}

export { claudeAdapter, ollamaAdapter };
```

---

## 5. 方案D: Tool Calling 做结构化输出

### 5.1 原理

利用 Function Calling 的机制做结构化输出：定义一个"假函数"，让 LLM "调用"它来输出结构化数据。LLM 在生成 function call 参数时，天然会遵循 JSON Schema 约束。

```
定义函数:
  output_result(name: string, age: number, city: string)

LLM 输出:
  tool_calls: [{ function: { name: "output_result", arguments: '{"name":"张三","age":28,"city":"北京"}' } }]

你的代码读取 arguments 并解析 → 获得结构化数据
```

### 5.2 完整实现

```typescript
// src/structured-output-tool-calling.ts
import { z, ZodType, ZodError } from "zod";

// ========== 用 Zod Schema 生成工具定义 ==========

/**
 * 将一个 Zod Schema 转换为 OpenAI Tool Definition
 * 这样 LLM 会以"调用函数"的形式返回符合 Schema 的数据
 */
function zodToToolDefinition(
  schema: ZodType,
  functionName: string = "output_structured_data",
  functionDescription: string = "输出结构化的分析结果"
): any {
  // 递归转换 Zod Schema 为 JSON Schema
  function convert(s: ZodType): any {
    if (s instanceof z.ZodObject) {
      const shape = (s as any)._def.shape();
      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const [key, field] of Object.entries(shape) as [string, any][]) {
        properties[key] = convert(field);

        // 如果不是 ZodOptional，则为必填
        if (!(field instanceof z.ZodOptional)) {
          required.push(key);
        }
      }

      return {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      };
    }

    if (s instanceof z.ZodArray) {
      return {
        type: "array",
        items: convert(s.element),
      };
    }

    if (s instanceof z.ZodEnum) {
      return {
        type: "string",
        enum: Object.values(s.Values),
      };
    }

    if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) {
      return convert(s.unwrap());
    }

    // 基础类型映射
    const typeMap: Record<string, any> = {
      ZodString: { type: "string" },
      ZodNumber: { type: "number" },
      ZodBoolean: { type: "boolean" },
    };

    const typeName = s._def?.typeName || "";
    const base = typeMap[typeName] || { type: "string" };

    // 携带 description
    if (s._def?.description) {
      base.description = s._def.description;
    }

    return base;
  }

  return {
    type: "function",
    function: {
      name: functionName,
      description: functionDescription,
      parameters: convert(schema),
    },
  };
}

// ========== 使用 Tool Calling 实现结构化输出 ==========

async function structuredOutputViaToolCalling<T extends ZodType>(
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  schema: T,
  options?: {
    functionName?: string;
    functionDescription?: string;
    maxRetries?: number;
  }
): Promise<{ data: z.infer<T>; attempts: number }> {
  // 动态导入 openai
  const OpenAI = (await import("openai")).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const toolName = options?.functionName || "output_result";
  const toolDesc = options?.functionDescription || "输出结构化的分析结果";
  const maxRetries = options?.maxRetries || 3;

  // 将 Zod Schema 转为工具定义
  const tool = zodToToolDefinition(schema, toolName, toolDesc);
  const allMessages = [...messages];

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const response = await openai.chat.completions.create({
      model,
      messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
      tools: [tool],
      tool_choice: {
        type: "function",
        function: { name: toolName },
      }, // 强制 LLM 必须调用这个函数
      temperature: 0.1,
    });

    const choice = response.choices[0];
    const toolCalls = choice.message.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      // LLM 没有调用工具，要求它重试
      allMessages.push(choice.message as any);
      allMessages.push({
        role: "user",
        content: `你必须调用 ${toolName} 函数来输出结果。请直接调用该函数。`,
      });
      continue;
    }

    try {
      const argsStr = toolCalls[0].function.arguments;
      const parsed = JSON.parse(argsStr);

      // Zod 校验
      const validationResult = schema.safeParse(parsed);
      if (validationResult.success) {
        return {
          data: validationResult.data as z.infer<T>,
          attempts: attempt,
        };
      }

      // 校验失败：反馈错误
      const errorMsg = formatToolCallZodError(validationResult.error);
      allMessages.push({
        role: "assistant",
        content: JSON.stringify({ tool_calls: toolCalls }),
      } as any);
      allMessages.push({
        role: "user",
        content: `参数校验失败，请修正后重新调用 ${toolName}:\n${errorMsg}`,
      });
    } catch (parseError: any) {
      allMessages.push(choice.message as any);
      allMessages.push({
        role: "user",
        content: `JSON 解析失败: ${parseError.message}。请重新调用 ${toolName} 并确保参数是合法 JSON。`,
      });
    }
  }

  throw new Error(`Tool Calling 结构化输出失败，已重试 ${maxRetries} 次`);
}

/** 格式化 ZodError 为 LLM 能理解的错误提示 */
function formatToolCallZodError(error: ZodError): string {
  return error.issues
    .map(
      (issue, i) =>
        `  ${i + 1}. 字段 "${issue.path.join(".")}": ${issue.message}（期望类型: ${issue.expected}，实际: ${issue.received}）`
    )
    .join("\n");
}

// ========== 使用示例 ==========

async function toolCallingExample() {
  const { z } = await import("zod");

  // 定义输出结构
  const articleSchema = z.object({
    title: z.string().describe("文章标题"),
    sentiment: z.enum(["positive", "negative", "neutral"]).describe("情感倾向"),
    keywords: z.array(z.string()).describe("关键词列表"),
    word_count: z.number().describe("字数统计"),
  });

  const result = await structuredOutputViaToolCalling(
    "gpt-4o",
    [
      {
        role: "system",
        content: "你是一个文章分析助手。请分析给定的文章内容。",
      },
      {
        role: "user",
        content: "《AI将如何改变教育》这篇文章写得很好，讨论了AI辅助教学、个性化学习和教育公平三个核心议题，全文约3000字。",
      },
    ],
    articleSchema,
    {
      functionName: "output_article_analysis",
      functionDescription: "输出文章分析的结构化结果",
    }
  );

  console.log("✅ Tool Calling 结构化输出:");
  console.log(`  标题: ${result.data.title}`);
  console.log(`  情感: ${result.data.sentiment}`);
  console.log(`  字数: ${result.data.word_count}`);
  console.log(`  关键词: ${result.data.keywords.join(", ")}`);
  console.log(`  共尝试 ${result.attempts} 次`);
}

export { structuredOutputViaToolCalling, toolCallingExample };
```

### 5.3 Tool Calling 方案的优缺点

```typescript
/**
 * 优点：
 * 1. 大多数主流模型都支持 Function Calling（OpenAI、Claude、Gemini、Qwen等）
 * 2. LLM 天生擅长遵循 function 的参数 schema
 * 3. 不需要 JSON Mode 或 Structured Output 特性
 * 4. 可以与真正的工具调用共存
 *
 * 缺点：
 * 1. 额外的 token 消耗（工具定义本身 + tool_call 格式开销）
 * 2. 有点 hack —— 定义了一个你并不会真正执行的"假函数"
 * 3. 某些模型对 tool_choice: "required" 的支持不完善
 * 4. 流式输出时处理 tool_calls 较复杂
 */
```

---

## 6. 方案对比与选择指南

### 6.1 综合对比表

| 维度 | 提示词约束 | JSON Mode | Structured Output | Zod + 重试 | Tool Calling |
|------|-----------|-----------|-------------------|-----------|--------------|
| **可靠性** | 低 (50-80%) | 中 (90%+) | 高 (99%+) | 高 (99%+) | 高 (95%+) |
| **模型支持** | 所有 | OpenAI | OpenAI (部分) | 所有 | 主流模型 |
| **字段名保证** | 无 | 无 | 有 | 有（通过重试） | 有 |
| **类型保证** | 无 | 无 | 有 | 有 | 有 |
| **额外Token** | 无 | 极少 | 中等 | 中等（重试时） | 高 |
| **实现复杂度** | 低 | 低 | 低 | 中 | 中 |
| **灵活性** | 极高 | 中 | 低（Schema有限制） | 极高 | 高 |
| **自愈能力** | 无 | 无 | 无 | 有（自动重试） | 有（反馈修正） |

### 6.2 决策树

```
开始
 │
 ├─ 只用 OpenAI 的 gpt-4o 系列？
 │   ├─ 是 → 用 Structured Output（方案B）
 │   │       配合 Zod 做防守校验
 │   │
 │   └─ 否 → 继续
 │
 ├─ 需要支持多种模型？
 │   ├─ 是 → 用 Zod + 重试（方案C，推荐）
 │   │       一次实现，到处使用
 │   │
 │   └─ 否 → 继续
 │
 ├─ 已经在用 Tool Calling？
 │   ├─ 是 → 顺便用 Tool Calling（方案D）
 │   │       不需要额外改动
 │   │
 │   └─ 否 → 继续
 │
 └─ 简单场景、对可靠性要求不高？
     └─ 是 → 用 JSON Mode（方案A）
```

### 6.3 推荐策略（组合使用）

```typescript
// src/recommended-strategy.ts — 推荐的组合策略

/**
 * 最佳实践中，三个层次的分层策略：
 *
 * 层次1（强制）: Zod Schema 定义
 *   - 所有的结构化输出都先定义 Zod Schema
 *   - 这是数据的"契约"，定义了正确的形状
 *
 * 层次2（API层）: Structured Output / JSON Mode / Tool Calling
 *   - 在 API 层面尽可能获得更强的保证
 *   - OpenAI: 优先用 Structured Output
 *   - 其他模型: 用 JSON Mode 或 Tool Calling
 *
 * 层次3（兜底层）: Zod 验证 + 重试
 *   - 无论 API 层面做了什么，always 做 Zod 校验
 *   - 校验失败时自动重试（最多3次）
 *   - 这是最后一道防线
 *
 * 这样即使第一道防线被突破（API不保证），
 * 第二道防线（重试）也能兜底。
 */

async function robustStructuredOutput<T extends z.ZodType>(
  schema: T,
  prompt: string,
  model: string = "gpt-4o"
): Promise<z.infer<T>> {
  // 尝试使用 Structured Output 快速路径
  try {
    if (model.startsWith("gpt-4o") || model.startsWith("o")) {
      return await openAIStructuredOutput(schema, prompt, model);
    }
  } catch {
    // Structured Output 不可用，降级到 Zod + 重试方案
    console.warn("Structured Output 不可用，降级到通用方案");
  }

  // 降级：使用 Zod + 重试方案（适用于所有模型）
  const result = await structuredChat({
    model,
    messages: [{ role: "user", content: prompt }],
    schema,
    maxRetries: 3,
  });

  return result.data;
}

// OpenAI Structured Output 快速路径
async function openAIStructuredOutput<T extends z.ZodType>(
  schema: T,
  prompt: string,
  model: string
): Promise<z.infer<T>> {
  const OpenAI = (await import("openai")).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // 将 Zod Schema 转换为 OpenAI json_schema 格式
  const jsonSchema = zodToOpenAISchema(schema);

  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: "你是一个数据提取助手。请从用户输入中提取信息并返回 JSON。",
      },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: jsonSchema,
    },
    temperature: 0.1,
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("LLM 返回空内容");

  const parsed = JSON.parse(content);

  // 即使有 Structured Output 保证，仍做 Zod 校验（防守编程）
  return schema.parse(parsed) as z.infer<T>;
}

/** 将 Zod Schema 转换为 OpenAI json_schema 格式 */
function zodToOpenAISchema(schema: z.ZodType): any {
  // 简化版实现，实际项目中可使用 zod-to-json-schema 库
  function convert(s: z.ZodType): any {
    if (s instanceof z.ZodObject) {
      const shape = (s as any)._def.shape();
      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const [key, field] of Object.entries(shape) as [string, any][]) {
        properties[key] = convert(field);
        if (!(field instanceof z.ZodOptional)) {
          required.push(key);
        }
      }

      return {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      };
    }
    if (s instanceof z.ZodArray) {
      return { type: "array", items: convert(s.element) };
    }
    if (s instanceof z.ZodEnum) {
      return { type: "string", enum: Object.values(s.Values) };
    }
    if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) {
      return convert(s.unwrap());
    }
    if (s instanceof z.ZodString) return { type: "string" };
    if (s instanceof z.ZodNumber) return { type: "number" };
    if (s instanceof z.ZodBoolean) return { type: "boolean" };
    return { type: "string" };
  }

  return {
    name: "response",
    strict: true,
    schema: convert(schema),
  };
}
```

---

## 7. 四个真实场景的完整示例

### 7.1 场景1：情感分析

```typescript
// src/examples/01-sentiment-analysis.ts
import { z } from "zod";
import { structuredChat } from "../structured-chat.js";

/**
 * 场景：从用户评论中提取情感分析结果
 * 下游使用：产品反馈大盘、客服自动分类
 */

// ========== Schema 定义 ==========
const sentimentResultSchema = z.object({
  sentiment: z
    .enum(["positive", "negative", "neutral", "mixed"])
    .describe("整体情感倾向"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("置信度，0到1之间的小数"),
  intensity: z
    .enum(["low", "medium", "high"])
    .describe("情感强度：低/中/高"),
  keywords: z
    .array(z.string())
    .max(10)
    .describe("影响判断的关键词，最多10个"),
  summary: z
    .string()
    .max(100)
    .describe("一句话总结用户情绪，不超过100字"),
  aspects: z
    .array(
      z.object({
        topic: z.string().describe("讨论的方面，如'价格'、'质量'"),
        sentiment: z.enum(["positive", "negative", "neutral"]).describe("该方面的情感"),
        detail: z.string().describe("具体描述"),
      })
    )
    .describe("按方面/话题拆分的细粒度情感"),
});

// ========== 执行分析 ==========
async function analyzeSentiment(review: string) {
  console.log(`\n📝 原文: ${review}`);

  const result = await structuredChat({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: `请分析以下用户评论的情感：\n\n${review}`,
      },
    ],
    schema: sentimentResultSchema,
    maxRetries: 3,
  });

  const d = result.data;

  console.log(`\n✅ 分析结果 (尝试 ${result.attempts} 次):`);
  console.log(`  整体情感: ${d.sentiment}`);
  console.log(`  置信度: ${(d.confidence * 100).toFixed(1)}%`);
  console.log(`  强度: ${d.intensity}`);
  console.log(`  摘要: ${d.summary}`);
  console.log(`  关键词: ${d.keywords.join(", ")}`);
  console.log(`  细分方面:`);
  d.aspects.forEach((a) => {
    console.log(`    - ${a.topic} (${a.sentiment}): ${a.detail}`);
  });

  return d;
}

// ========== 测试 ==========
async function main() {
  // 测试混合情感
  await analyzeSentiment(
    "这款手机拍照效果确实惊艳，夜景模式特别好用。但是电池续航太差了，" +
    "一天要充两次电。价格倒还行，5999不算贵但也不便宜。"
  );

  // 测试正面情感
  await analyzeSentiment(
    "太棒了！！物流超快昨天下单今天就到了，客服态度也很好，" +
    "主动帮我换了尺码。以后就认准这家店了，必须给五星好评！"
  );
}

main().catch(console.error);
```

### 7.2 场景2：文档信息提取

```typescript
// src/examples/02-document-extraction.ts
import { z } from "zod";
import { structuredChat } from "../structured-chat.js";

/**
 * 场景：从非结构化文档中提取结构化信息
 * 下游使用：合同管理系统、简历解析、论文元数据提取
 */

// ========== Schema 定义 ==========
const documentExtractionSchema = z.object({
  title: z.string().describe("文档标题"),
  authors: z
    .array(
      z.object({
        name: z.string().describe("作者姓名"),
        affiliation: z.string().optional().describe("所属机构（可选）"),
        email: z.string().optional().describe("邮箱（可选）"),
      })
    )
    .describe("作者列表"),
  date: z.string().optional().describe("发布日期（ISO 8601格式，如2024-01-15）"),
  document_type: z
    .enum(["research_paper", "news_article", "technical_report", "blog_post", "legal_document", "other"])
    .describe("文档类型"),
  language: z.string().default("zh").describe("文档语言"),
  summary: z.string().max(300).describe("文档摘要，不超过300字"),
  keywords: z.array(z.string()).max(15).describe("关键词，最多15个"),
  entities: z
    .array(
      z.object({
        name: z.string().describe("实体名称"),
        type: z
          .enum(["person", "organization", "location", "product", "technology", "event", "date", "other"])
          .describe("实体类型"),
        mentions: z.number().min(1).describe("提及次数"),
      })
    )
    .describe("文档中提到的命名实体列表"),
  word_count: z.number().min(0).describe("大约字数（估算）"),
});

// ========== 执行提取 ==========
async function extractDocument(text: string) {
  console.log(`\n📄 文档前100字: ${text.slice(0, 100)}...`);

  const result = await structuredChat({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: `请分析以下文档，提取其中的结构化信息：\n\n${text}`,
      },
    ],
    schema: documentExtractionSchema,
    maxRetries: 3,
  });

  const d = result.data;

  console.log(`\n✅ 提取结果:`);
  console.log(`  标题: ${d.title}`);
  console.log(`  类型: ${d.document_type}`);
  console.log(`  日期: ${d.date || "未提取到"}`);
  console.log(`  作者: ${d.authors.map((a) => `${a.name}(${a.affiliation || "未知机构"})`).join(", ")}`);
  console.log(`  摘要: ${d.summary}`);
  console.log(`  关键词: ${d.keywords.join(", ")}`);
  console.log(`  预估字数: ${d.word_count}`);
  console.log(`  实体:`);
  d.entities.forEach((e) => {
    console.log(`    - [${e.type}] ${e.name} (提及${e.mentions}次)`);
  });

  return d;
}

// ========== 测试 ==========
async function main() {
  const samplePaper = `
基于大语言模型的知识图谱自动构建方法研究

作者: 张伟¹, 李娜²
¹ 清华大学计算机科学与技术系, zhangwei@tsinghua.edu.cn
² 北京大学人工智能研究院

2025年3月15日

摘要:
本文提出了一种基于大语言模型（LLM）的知识图谱自动构建框架KG-LLM。
该框架利用GPT-4和Claude等先进LLM的语义理解能力，实现了从非结构化文本中
自动抽取出实体和关系，并构建成结构化的知识图谱。我们在DBPedia和WikiData
两个公开数据集上进行了实验，结果表明KG-LLM在实体识别（NER）任务上达到
92.3%的F1分数，在关系抽取（RE）任务上达到85.7%的F1分数，相比传统基于
BERT的方法分别提升了12.1%和9.8%。此外，我们还开发了基于该框架的原型系统，
并在医疗和法律两个垂直领域进行了应用验证，取得了良好的效果。

关键词: 大语言模型, 知识图谱, 信息抽取, 实体识别, 关系抽取
  `.trim();

  await extractDocument(samplePaper);
}

main().catch(console.error);
```

### 7.3 场景3：代码审查

```typescript
// src/examples/03-code-review.ts
import { z } from "zod";
import { structuredChat } from "../structured-chat.js";

/**
 * 场景：对代码片段进行自动化审查
 * 下游使用：CI/CD 流水线中的代码审查机器人、PR Review 自动化
 */

// ========== Schema 定义 ==========
const codeReviewSchema = z.object({
  overall_score: z.number().min(0).max(100).describe("代码整体评分，0到100"),
  summary: z.string().max(200).describe("整体评价摘要"),
  issues: z
    .array(
      z.object({
        severity: z
          .enum(["critical", "high", "medium", "low", "info"])
          .describe("严重程度"),
        category: z
          .enum([
            "security",      // 安全问题
            "performance",   // 性能问题
            "bug",           // 潜在bug
            "readability",   // 可读性
            "maintainability", // 可维护性
            "best_practice", // 最佳实践
            "type_safety",   // 类型安全
          ])
          .describe("问题类别"),
        line: z.number().optional().describe("建议的行号（可选）"),
        title: z.string().describe("问题标题"),
        description: z.string().describe("详细描述"),
        suggestion: z.string().describe("具体修复建议"),
        code_snippet: z.string().optional().describe("问题代码片段（可选）"),
        fixed_snippet: z.string().optional().describe("修复后的代码片段（可选）"),
        references: z.array(z.string()).optional().describe("参考资料链接（可选）"),
      })
    )
    .describe("发现的问题列表"),
  strengths: z
    .array(z.string())
    .max(5)
    .describe("代码优点，最多5条"),
});

// ========== 执行审查 ==========
async function reviewCode(code: string, language: string = "typescript") {
  console.log(`\n🔍 审查代码 (${language}):`);
  console.log("```" + language);
  console.log(code.slice(0, 500) + (code.length > 500 ? "\n... (截断)" : ""));
  console.log("```");

  const result = await structuredChat({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `你是一名资深 ${language} 代码审查专家。请严格审查代码，发现所有可能的问题。`,
      },
      {
        role: "user",
        content: `请审查以下 ${language} 代码：\n\n\`\`\`${language}\n${code}\n\`\`\``,
      },
    ],
    schema: codeReviewSchema,
    maxRetries: 3,
  });

  const d = result.data;

  // 按严重程度排序
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const sortedIssues = [...d.issues].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );

  console.log(`\n✅ 审查结果:`);
  console.log(`  整体评分: ${d.overall_score}/100`);
  console.log(`  摘要: ${d.summary}`);
  console.log(`  优点:`);
  d.strengths.forEach((s) => console.log(`    ✅ ${s}`));

  console.log(`\n  问题 (${d.issues.length}个):`);
  sortedIssues.forEach((issue, i) => {
    const emoji = {
      critical: "🔴", high: "🟠", medium: "🟡", low: "🔵", info: "⚪",
    }[issue.severity];

    console.log(`    ${i + 1}. ${emoji} [${issue.severity.toUpperCase()}] [${issue.category}] ${issue.title}`);
    console.log(`       描述: ${issue.description}`);
    console.log(`       建议: ${issue.suggestion}`);
    if (issue.code_snippet && issue.fixed_snippet) {
      console.log(`       ❌ 原代码: ${issue.code_snippet.slice(0, 80)}`);
      console.log(`       ✅ 修复后: ${issue.fixed_snippet.slice(0, 80)}`);
    }
    if (issue.references?.length) {
      console.log(`       参考: ${issue.references.join(", ")}`);
    }
  });

  return d;
}

// ========== 测试 ==========
async function main() {
  const vulnerableCode = `
// 一个含有多处问题的 TypeScript 代码
async function getUserData(userId: string) {
  // 问题1: SQL注入风险 — 直接拼接用户输入
  const query = "SELECT * FROM users WHERE id = '" + userId + "'";
  const user = await db.query(query);

  // 问题2: 密码明文存储
  user.password = req.body.password;

  // 问题3: 没有错误处理
  await db.save(user);

  // 问题4: any 类型滥用
  const result: any = JSON.parse(JSON.stringify(user));

  // 问题5: 未使用的变量
  const unusedVar = "dead code";

  // 问题6: console.log 留在生产代码中
  console.log("User data:", result);

  return result;
}
  `.trim();

  await reviewCode(vulnerableCode, "typescript");
}

main().catch(console.error);
```

### 7.4 场景4：多选分类

```typescript
// src/examples/04-multi-classification.ts
import { z } from "zod";
import { structuredChat } from "../structured-chat.js";

/**
 * 场景：将文本分类到预定义的类别体系中
 * 下游使用：客服工单自动分类、内容标签化、知识库组织
 */

// ========== Schema 定义 ==========
const classificationSchema = z.object({
  category: z
    .enum([
      "bug_report",       // Bug报告
      "feature_request",  // 功能请求
      "usage_question",   // 使用问题
      "account_issue",    // 账号问题
      "billing_inquiry",  // 账单咨询
      "complaint",        // 投诉
      "feedback",         // 反馈
      "other",            // 其他
    ])
    .describe("主要分类"),
  subcategory: z
    .string()
    .describe("细分子类别，如 bug_report 下可分为 'UI异常'、'数据错误'、'崩溃闪退'"),
  tags: z
    .array(z.string())
    .max(10)
    .describe("相关标签，如产品名称、功能模块等，最多10个"),
  priority: z
    .enum(["urgent", "high", "medium", "low"])
    .describe("紧急程度"),
  language: z
    .enum(["zh", "en", "ja", "ko", "other"])
    .default("zh")
    .describe("用户使用的语言"),
  sentiment: z
    .enum(["angry", "frustrated", "neutral", "satisfied", "happy"])
    .describe("用户情绪"),
  requires_human: z
    .boolean()
    .describe("是否需要人工处理"),
  auto_reply_suitable: z
    .boolean()
    .describe("是否适合自动回复"),
  suggested_response: z
    .string()
    .optional()
    .describe("建议的自动回复内容（如适合自动回复的话）"),
  extracted_info: z
    .object({
      product_name: z.string().optional().describe("涉及的产品名称"),
      version: z.string().optional().describe("产品版本号"),
      platform: z.string().optional().describe("平台信息，如 iOS/Android/Web"),
      order_id: z.string().optional().describe("订单号"),
    })
    .describe("提取的具体信息"),
});

// ========== 执行分类 ==========
async function classifyTicket(ticket: { id: string; content: string }) {
  console.log(`\n📋 工单 #${ticket.id}: ${ticket.content.slice(0, 100)}...`);

  const result = await structuredChat({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "你是一个客服工单分类助手。请仔细分析工单内容，给出准确的分类和标签。",
      },
      {
        role: "user",
        content: `请分类以下客服工单：\n\n${ticket.content}`,
      },
    ],
    schema: classificationSchema,
    maxRetries: 3,
  });

  const d = result.data;

  console.log(`\n✅ 分类结果:`);
  console.log(`  主分类: ${d.category}`);
  console.log(`  子分类: ${d.subcategory}`);
  console.log(`  优先级: ${d.priority}`);
  console.log(`  用户情绪: ${d.sentiment}`);
  console.log(`  标签: ${d.tags.join(", ")}`);
  console.log(`  需要人工: ${d.requires_human ? "是" : "否"}`);
  console.log(`  适合自动回复: ${d.auto_reply_suitable ? "是" : "否"}`);
  if (d.suggested_response) {
    console.log(`  建议回复: ${d.suggested_response}`);
  }
  if (d.extracted_info.product_name) {
    console.log(`  产品: ${d.extracted_info.product_name} ${d.extracted_info.version || ""}`);
  }

  return d;
}

// ========== 测试多场景 ==========
async function main() {
  // 测试Bug报告
  await classifyTicket({
    id: "T-1001",
    content:
      "你们的App更新到3.2.1版本后，打开就闪退。iPhone 15 Pro, iOS 18.1。" +
      "我试了重启手机也没用。严重影响使用，请尽快修复！！！",
  });

  // 测试功能请求
  await classifyTicket({
    id: "T-1002",
    content:
      "建议增加夜间模式功能，晚上看文档的时候白色背景太刺眼了。" +
      "最好能根据系统时间自动切换。隔壁Notion已经有了这个功能。",
  });

  // 测试账单问题
  await classifyTicket({
    id: "T-1003",
    content:
      "我的账单上多了一笔 ¥299 的扣款，我查了并没有订阅这个服务。" +
      "订单号 ORD-20250315-8842，请帮我核实并退款。",
  });

  // 测试使用问题
  await classifyTicket({
    id: "T-1004",
    content:
      "请问怎么批量导出数据？我需要在月底前导出所有销售记录做报表。" +
      "目前只能一条条导出，效率太低了。谢谢！",
  });
}

main().catch(console.error);
```

---

## 8. 总结与最佳实践

### 8.1 核心原则

```
1. Always define a schema（永远定义 Schema）
   └── 用 Zod 定义数据的"契约"，它是所有方案的基础

2. Push constraints to the API layer（尽量用API层约束）
   └── OpenAI → Structured Output
   └── 其他 → JSON Mode 或 Tool Calling

3. Always validate at the code layer（永远在代码层做校验）
   └── Zod safeParse → 成功则返回
   └── 失败则反馈错误 → 重试

4. Never trust raw LLM output（永远不要信任LLM的原始输出）
   └── 没有校验的 LLM 输出 = 定时炸弹
```

### 8.2 快速集成清单

你只需要复制以下两个核心函数到你的项目中：

1. **`structuredChat<T>()`** — 通用方案（方案C），适用于所有模型
2. **`robustStructuredOutput<T>()`** — 推荐的组合策略（6.3节），自动选择最优方案

```typescript
// ========== 最简使用方式 ==========
import { z } from "zod";

// 1. 定义期望的数据结构（一次定义，到处使用）
const MySchema = z.object({
  name: z.string(),
  score: z.number(),
  tags: z.array(z.string()),
});

// 2. 调用 structuredChat，获取带类型的对象
const result = await structuredChat({
  model: "gpt-4o",
  messages: [{ role: "user", content: "分析这段文本..." }],
  schema: MySchema,
});

// 3. TypeScript 自动推导出 result.data 的类型
// result.data.name    → string
// result.data.score   → number
// result.data.tags    → string[]
console.log(result.data.name);
```

### 8.3 注意事项

```typescript
/**
 * 1. 温度参数：结构化输出时建议 temperature ≤ 0.3
 *    —— 低温度让 LLM 更稳定地遵循格式
 *
 * 2. 系统提示词：明确说明"只返回JSON，不要添加解释"
 *    —— 减少提取 JSON 的困难
 *
 * 3. 必填字段：不要让 LLM 省略字段
 *    —— 在 Schema 中定义 .default() 或用 ZodOptional 标记可选字段
 *    —— 不全的字段填 "" 或 0，而不是不返回
 *
 * 4. 重试次数：建议 2-3 次
 *    —— 太多重试浪费 token，太少可能修复不了
 *    —— 统计表明 95% 的失败在 2 次内修复
 *
 * 5. 错误信息：反馈给 LLM 的错误信息要精确
 *    —— "age 期望 number，实际得到 string" 比 "JSON格式错误" 有效得多
 *    —— 使用 formatZodErrors() 生成精确的错误描述
 *
 * 6. Token 预算：结构化输出会增加 token 消耗
 *    —— Schema 定义 ~50-200 tokens
 *    —— 每次重试 ~200-1000 tokens
 *    —— 做好预算
 */
```

---

## 9. 完整项目文件结构

```
structured-output-demo/
├── package.json
├── tsconfig.json
├── .env                          # OPENAI_API_KEY=sk-...
├── src/
│   ├── structured-chat.ts        # 核心：结构化聊天函数（方案C，通用）
│   ├── structured-output-tool-calling.ts  # 方案D：Tool Calling 实现
│   ├── custom-llm-adapter.ts      # 自定义 LLM 适配器（Claude/Ollama）
│   ├── recommended-strategy.ts    # 推荐的组合策略
│   ├── demo-structured-chat.ts   # 用法示例
│   └── examples/
│       ├── 01-sentiment-analysis.ts     # 场景1：情感分析
│       ├── 02-document-extraction.ts    # 场景2：文档信息提取
│       ├── 03-code-review.ts            # 场景3：代码审查
│       └── 04-multi-classification.ts   # 场景4：多选分类
```

---

**结构化输出是 AI 应用从 Demo 走向 Production 的第一步。没有它，你的下游代码就是在走钢丝。有了它，LLM 的输出就变得可预测、可信任、可集成。**
