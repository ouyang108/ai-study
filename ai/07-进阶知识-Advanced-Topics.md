# AI 进阶知识汇总

## 1. Fine-tuning（模型微调）

### 1.1 什么时候需要微调

| 场景 | 推荐方案 |
|------|----------|
| 让模型遵循特定格式输出 | Prompt Engineering（不需要微调） |
| 补充最新知识 | RAG（不需要微调） |
| 让模型学会特定风格/语气 | Fine-tuning |
| 让模型掌握领域专业术语 | Fine-tuning |
| 减少 Prompt 长度（把指令"烧录"进模型） | Fine-tuning |
| 小模型达到大模型效果 | Fine-tuning |
| 处理非公开的特殊任务 | Fine-tuning |

### 1.2 微调方法对比

| 方法 | 说明 | 显存需求 | 训练速度 |
|------|------|----------|----------|
| **Full Fine-tuning** | 更新所有参数 | 极高(~16×模型大小) | 慢 |
| **LoRA** | 低秩适配，只训练小矩阵 | 低(~模型大小的0.1%) | 快 |
| **QLoRA** | 量化 + LoRA | 极低（单卡可跑70B） | 快 |
| **Prefix Tuning** | 只训练前缀向量 | 低 | 快 |
| **P-Tuning** | 可学习的连续 Prompt | 低 | 快 |

### 1.3 LoRA 微调实战

> **注意**: Fine-tuning（模型微调）主要在 Python 生态中进行。Node.js/TypeScript 中通常通过以下方式实现：
> - 使用 `@xenova/transformers` 进行推理（加载已微调的模型）
> - 调用 Python 微调 API（如通过子进程或 HTTP 服务）
> - 使用 HuggingFace 的 Inference API 或专用微调服务
>
> 以下为 LoRA 微调的 **概念性 TypeScript 示例**，展示配置结构和数据格式。实际训练仍推荐使用 Python + LLaMA-Factory / Unsloth 等框架。

```typescript
// LoRA 微调配置 — 概念示例（实际训练推荐 Python + LLaMA-Factory）
// 推理阶段可用 @xenova/transformers 加载已微调的模型

// LoRA 配置参数（对应 Python PEFT 的 LoraConfig）
const loraConfig = {
  taskType: "CAUSAL_LM",       // 因果语言模型
  r: 8,                         // LoRA 秩，越大表达能力越强
  loraAlpha: 32,                // 缩放参数，通常为 r 的 2-4 倍
  loraDropout: 0.1,             // 防止过拟合
  targetModules: ["q_proj", "v_proj", "k_proj", "o_proj"],  // 目标层
};

// 可训练参数占比约 0.11%（8.4M / 7.6B 参数）

// 准备数据（指令微调格式）
interface InstructionSample {
  input: string;
  output: string;
}

function formatInstruction(sample: InstructionSample): { text: string } {
  return {
    text: `<|im_start|>system
你是一个专业的技术文档翻译助手。<|im_end|>
<|im_start|>user
${sample.input}<|im_end|>
<|im_start|>assistant
${sample.output}<|im_end|>`,
  };
}

// 训练参数
const trainingArgs = {
  outputDir: "./lora-output",
  perDeviceTrainBatchSize: 4,
  gradientAccumulationSteps: 4,  // 模拟更大 batch
  numTrainEpochs: 3,
  learningRate: 2e-4,
  loggingSteps: 10,
  saveSteps: 100,
  bf16: true,
};

// === Node.js 推理示例（加载已微调的模型） ===
// import { pipeline } from "@xenova/transformers";
//
// const generator = await pipeline("text-generation", "./my-lora-weights");
// const result = await generator("请翻译以下内容：...");
// console.log(result);
```

### 1.4 微调数据准备

```typescript
// 高质量微调数据格式
const trainingData = [
  {
    messages: [
      { role: "system", content: "你是技术文档翻译专家" },
      { role: "user", content: "请将以下代码注释翻译成中文：\n// Initialize the database connection pool" },
      { role: "assistant", content: "// 初始化数据库连接池" },
    ],
  },
  // ... 更多数据
];
// 一般需要 50-1000 条高质量数据
```

### 1.5 推荐文章与资源

| 资源 | 链接 |
|------|------|
| **OpenAI Fine-tuning 文档** | https://platform.openai.com/docs/guides/fine-tuning |
| **HuggingFace PEFT** | https://github.com/huggingface/peft |
| **LLaMA-Factory** | https://github.com/hiyouga/LLaMA-Factory — 最易用的微调框架 |
| **Unsloth** | https://github.com/unslothai/unsloth — 2-5倍加速微调 |
| **Axolotl** | https://github.com/OpenAccess-AI-Collective/axolotl — 灵活的微调工具 |
| **LoRA 论文** | https://arxiv.org/abs/2106.09685 |
| **QLoRA 论文** | https://arxiv.org/abs/2305.14314 |

---

## 2. Embedding 与语义搜索

### 2.1 Embedding 原理

Embedding 将文本映射为高维向量，使语义相似的文本在向量空间中距离更近：

```
"你好" → [0.12, -0.34, 0.56, ..., 0.78]  (如 1024 维向量)
"您好" → [0.13, -0.32, 0.55, ..., 0.79]  (向量接近)
"再见" → [-0.45, 0.67, -0.12, ..., -0.33] (向量较远)
```

### 2.2 相似度计算

```typescript
// 余弦相似度（最常用）
function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (normA * normB);
}

// 欧几里得距离
function euclideanDistance(a: number[], b: number[]): number {
  const sumSquares = a.reduce((sum, val, i) => sum + (val - b[i]) ** 2, 0);
  return Math.sqrt(sumSquares);
}

// 点积（向量已归一化时等价于余弦相似度）
function dotProduct(a: number[], b: number[]): number {
  return a.reduce((sum, val, i) => sum + val * b[i], 0);
}
```

### 2.3 中文 Embedding 模型推荐

| 模型 | MTEB中文排名 | 维度 | 说明 |
|------|-------------|------|------|
| **BGE-M3** | Top 1 | 1024 | BAAI 出品，支持稠密+稀疏+多向量 |
| **stella-base-zh-v3-1792d** | Top 2 | 1792 | 中文专项优化 |
| **GTE-Qwen2-7B-instruct** | Top 3 | 3584 | 基于 Qwen2，需更多资源 |
| **m3e-base** | 良好 | 768 | 轻量中文 Embedding |
| **text2vec-large-chinese** | 良好 | 1024 | CoSENT 训练，中文经典 |

### 2.4 使用示例

```typescript
// 方法1：使用 @xenova/transformers（本地运行，无需 API）
// import { pipeline } from "@xenova/transformers";
//
// const extractor = await pipeline("feature-extraction", "BAAI/bge-m3");
// const emb1 = await extractor("今天天气真好", { pooling: "mean", normalize: true });
// const emb2 = await extractor("今天是个好天气", { pooling: "mean", normalize: true });
// const similarity = cosineSimilarity(emb1.data, emb2.data);
// console.log(`相似度: ${similarity}`); // 0.92~

// 方法2：使用 OpenAI API
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: [text],
  });
  return response.data[0].embedding;
}

// 使用示例
// const embedding = await getEmbedding("今天天气真好");
```

---

## 3. Function Calling / Tool Use

### 3.1 原理

Function Calling 让 LLM **不直接执行函数**，而是**输出结构化的函数调用参数**，由开发者执行后再把结果返回给 LLM。

```
用户: "北京今天天气如何"
  ↓
LLM 输出: 需要调用函数 get_weather(city="北京")
  ↓
开发者执行: fetch("https://api.weather.com/beijing")
  ↓
返回结果给 LLM: {"temp": 25, "weather": "晴"}
  ↓
LLM 最终回复: "北京今天晴天，气温25°C"
```

### 3.2 OpenAI Function Calling 示例

```typescript
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 定义函数
const tools = [
  {
    type: "function" as const,
    function: {
      name: "get_weather",
      description: "获取指定城市的实时天气",
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "城市名称，如 '北京'",
          },
          unit: {
            type: "string",
            enum: ["celsius", "fahrenheit"],
            description: "温度单位",
          },
        },
        required: ["city"],
      },
    },
  },
];

async function askWeather() {
  // 第一次调用：LLM 决定调用函数
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: "北京今天天气怎样？" }],
    tools: tools,
    tool_choice: "auto",  // auto: 自动决定 / required: 必须调用 / none: 不调用
  });

  // 提取函数调用参数
  const toolCall = response.choices[0].message.tool_calls![0];
  const functionName = toolCall.function.name;  // "get_weather"
  const args = JSON.parse(toolCall.function.arguments);  // { city: "北京" }

  // 执行函数（模拟 API 调用）
  const weatherResult = await fetch(
    `https://api.weather.com?city=${args.city}`
  ).then((res) => res.json());

  // 第二次调用：将函数结果返回给 LLM，让它生成最终回复
  const finalResponse = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "user", content: "北京今天天气怎样？" },
      { role: "assistant", tool_calls: [toolCall] },
      {
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(weatherResult),
      },
    ],
  });

  console.log(finalResponse.choices[0].message.content);
  // "北京今天晴，气温28°C，建议注意防晒。"
}

// askWeather();
```

### 3.3 最佳实践

1. **函数描述要详细**：LLM 靠 description 来选择是否调用，写得越清楚越好
2. **参数类型要精确**：用 JSON Schema 严格定义，避免歧义
3. **返回结果要简洁**：给 LLM 的函数结果要精简，去掉无关字段
4. **错误处理**：函数执行失败时，返回错误信息让 LLM 自行处理或告诉用户

---

## 4. AI 应用评估体系

### 4.1 评估金字塔

```
            ┌──────────────┐
            │  业务评估     │ ← 用户满意度、留存率、转化率
            │  (最重要)     │
           ┌┤              ├┐
           ││  人工评估     ││ ← 专家打分、A/B 测试
           ││  (标准)       ││
          ┌┤│              │├┐
          │││  自动评估     │││ ← LLM-as-Judge、RAGAS
          │││  (快速)       │││
         ┌┤││              │├│┐
         ││││  启发式评估   ││││ ← 正则、关键词匹配
         ││││  (基础)       ││││
         └┴┴┴──────────────┴┴┴┘
```

### 4.2 评估框架汇总

| 框架 | 适用场景 | 特点 |
|------|----------|------|
| [RAGAS](https://github.com/explodinggradients/ragas) | RAG 系统 | 忠实度、相关性、召回率 |
| [DeepEval](https://github.com/confident-ai/deepeval) | 通用 LLM | 指标丰富，CI/CD 集成 |
| [TruLens](https://github.com/truera/trulens) | LLM 应用 | 可观测性+评估 |
| [LangSmith](https://www.langchain.com/langsmith) | LangChain 生态 | 调试+测试+监控 |
| [Phoenix (Arize)](https://github.com/Arize-AI/phoenix) | LLM 可观测性 | 开源，可视化好 |
| [Promptfoo](https://github.com/promptfoo/promptfoo) | Prompt 测试 | 红队测试、对比评估 |

### 4.3 LLM-as-Judge

```typescript
// 用强模型评估弱模型
async function llmAsJudge(
  question: string,
  answer: string,
  reference?: string
): Promise<string> {
  const judgePrompt = `你是一位严格的AI输出评估专家。

请评估以下回答的质量，从以下维度打分（1-5分）：

## 评估维度
1. 准确性：回答中的事实是否准确？
2. 完整性：是否完全回答了问题？
3. 简洁性：是否直截了当，没有冗余？
4. 安全性：是否有害、偏见或不当内容？

## 问题
${question}

## AI 回答
${answer}

## 参考答案（可选）
${reference ?? "无"}

请给出每个维度的分数和简短理由，最后给出总分。`;

  // 调用 LLM 进行评判（使用 OpenAI SDK 示例）
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: judgePrompt }],
  });
  return response.choices[0].message.content ?? "";
}
```

---

## 5. AI 安全

### 5.1 OWASP Top 10 for LLM

| 排名 | 风险 |
|------|------|
| 1 | Prompt Injection（提示词注入） |
| 2 | Insecure Output Handling（不安全的输出处理） |
| 3 | Training Data Poisoning（训练数据投毒） |
| 4 | Model Denial of Service（模型拒绝服务） |
| 5 | Supply Chain Vulnerabilities（供应链漏洞） |
| 6 | Sensitive Information Disclosure（敏感信息泄露） |
| 7 | Insecure Plugin Design（不安全的插件设计） |
| 8 | Excessive Agency（过度自主权） |
| 9 | Overreliance（过度依赖） |
| 10 | Model Theft（模型盗窃） |

**参考**: https://owasp.org/www-project-top-10-for-large-language-model-applications/

### 5.2 安全防护清单

```typescript
// AI 应用安全检查清单
const securityChecklist = {
  "输入安全": [
    "是否有 Prompt Injection 防护？",
    "是否对用户输入做了长度限制？",
    "是否过滤了特殊字符/指令注入？",
  ],
  "输出安全": [
    "是否过滤了敏感信息（API 密钥、密码）？",
    "是否防止了 XSS（对 Web 输出做转义）？",
    "是否检查了有害内容？",
  ],
  "权限控制": [
    "Agent 工具权限是否遵循最小权限原则？",
    "敏感操作是否需要人类确认？",
    "是否限制了一次调用的最大 token 数？",
  ],
  "数据安全": [
    "用户数据是否加密存储？",
    "是否记录了审计日志？",
    "是否遵守了 GDPR/个人信息保护法？",
  ],
};
```

### 5.3 Guardrails（安全护栏）

> **概念参考** — NeMo Guardrails 是 Python 生态的安全护栏框架。
> Node.js 中可参考以下替代方案：
> - **Guardrails AI**: https://github.com/guardrails-ai/guardrails （Python 服务 + Node 客户端）
> - **LangChain Safety**: 通过 LangChain.js 实现类似功能
> - **自定义护栏**: 使用 OpenAI Moderation API 或 Anthropic 的安全过滤

```typescript
// NeMo Guardrails 概念示例 — 安全护栏的核心思想（Node.js 中无直接等价库）
// 概念: 定义规则 → 自动拦截不安全输入/输出 → 返回安全响应
//
// NeMo Guardrails 通过 YAML 配置文件定义规则（如 config/rails.co）：
// ```
// rails:
//   input:
//     - type: block
//       flows:
//         - check_harmful_content
//   output:
//     - type: block
//       flows:
//         - check_harmful_content
// ```
//
// 然后通过 HTTP API 调用（部署为独立服务）：
// const response = await fetch("http://localhost:8000/v1/chat/completions", {...});
// → "抱歉，我无法提供这方面的帮助。"
```

```typescript
// Node.js 中的替代方案 — 使用 OpenAI Moderation API 做内容安全检测
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function checkContentSafety(text: string): Promise<boolean> {
  const response = await client.moderations.create({ input: text });
  const result = response.results[0];
  return !result.flagged;  // true 表示安全，false 表示被拦截
}

// 其他 Guardrails 工具：
// - Guardrails AI: https://github.com/guardrails-ai/guardrails
// - LangChain Guardrails: https://js.langchain.com/docs/guides/safety
```

---

## 6. AI 应用可观测性（Observability）

### 6.1 核心监控指标

| 指标类型 | 具体指标 |
|----------|----------|
| 性能 | 首 token 延迟、总延迟、吞吐量 |
| 质量 | 用户满意度评分、反馈率 |
| 成本 | Token 消耗、API 调用次数 |
| 错误 | 错误率、重试率、超时率 |
| 安全 | 被拦截请求数、异常输入数 |

### 6.2 可观测性工具

| 工具 | 特点 | 链接 |
|------|------|------|
| **LangSmith** | LangChain 官方 | https://smith.langchain.com/ |
| **LangFuse** | 开源，功能完整 | https://github.com/langfuse/langfuse |
| **Phoenix** | 开源，可视化好 | https://github.com/Arize-AI/phoenix |
| **Weights & Biases** | 实验追踪 | https://wandb.ai/ |
| **MLflow** | 模型生命周期 | https://github.com/mlflow/mlflow |

---

## 7. 推荐文章与资源汇总

### 7.1 必读 AI Newsletter / Blog
- [The Batch (Andrew Ng)](https://www.deeplearning.ai/the-batch/)
- [Lilian Weng's Blog](https://lilianweng.github.io/) — OpenAI 研究员的博客
- [Anthropic Engineering Blog](https://www.anthropic.com/engineering)
- [OpenAI Research](https://openai.com/research/)
- [Google AI Blog](https://blog.research.google/)
- [Meta AI Blog](https://ai.meta.com/blog/)

### 7.2 中文学习资源
- [Datawhale 开源学习](https://github.com/datawhalechina) — AI 学习路线
- [动手学深度学习 (d2l.ai)](https://d2l.ai/) — 李沐的经典教材
- [Hugging Face NLP Course 中文版](https://huggingface.co/learn/nlp-course/zh-CN)
- [提示工程指南 (中文)](https://www.promptingguide.ai/zh)

### 7.3 实战项目推荐
- [Dify](https://github.com/langgenius/dify) — 搭建自己的 AI 应用
- [FastGPT](https://github.com/labring/FastGPT) — 搭建知识库问答
- [Open WebUI](https://github.com/open-webui/open-webui) — 自建 ChatGPT 界面
- [Lobe Chat](https://github.com/lobehub/lobe-chat) — 现代化聊天框架
- [Langflow](https://github.com/langflow-ai/langflow) — 可视化 AI 工作流
