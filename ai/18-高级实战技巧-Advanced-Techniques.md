# 高级实战技巧：Scratchpad / 长上下文路由 / 记忆压缩

这三个技术是现代 AI Agent 和 RAG 系统的"高级内功"。面试和实际项目中，区别初级和高级 AI 工程师的关键就看会不会这些。

---

## 1. Scratchpad（草稿本机制）

### 1.1 什么是 Scratchpad

Scratchpad 是给 LLM 留的一段"草稿空间"，让它**在给出最终答案之前，先把中间思考过程写下来**。这跟 CoT（思维链）本质一样，但有重要区别：

```
CoT（被动）:      Prompt 里写"一步一步思考" → LLM 边想边说
Scratchpad（主动）: 单独开辟一个区域 → LLM 在里面打草稿 → 打完再输出最终答案
```

**为什么需要 Scratchpad？**

| 场景 | 无 Scratchpad | 有 Scratchpad |
|------|--------------|---------------|
| 复杂数学题 | 可能边算边说，算错了也继续往下 | 先列公式、代入、验证，确认后再输出 |
| 多步 Agent 任务 | 想到哪做到哪，可能中途跑偏 | 先完整规划 → 记下计划 → 按步骤执行 |
| 代码生成 | 第一版就输出，可能漏需求 | 先分析需求 → 列要点 → 再写代码 |
| 事实核查 | 信息不确认就输出 | 先列出不确定的点 → 逐一核实 → 再回答 |

### 1.2 Scratchpad 的实现方式

#### 方式A：单次调用 + Prompt 分隔（最简单）

```typescript
// 在 system prompt 中定义 scratchpad 区域
const SCRATCHPAD_SYSTEM_PROMPT = `你是一个认真严谨的助手。

## 工作方式
每次回答前，请先在 <scratchpad> 标签内写下你的思考过程：

<scratchpad>
1. 用户问的是什么？（用自己的话复述）
2. 我需要哪些信息来回答？
3. 哪些信息我不确定？
4. 我的回答大纲是什么？
</scratchpad>

然后输出最终回答。

## 规则
- scratchpad 中的内容不会被用户看到
- 如果 scratchpad 中标记了"不确定"，请在回答中诚实说明
- 不要在回答中重复 scratchpad 的内容`;

// 使用
const response = await client.chat.completions.create({
  model: "claude-sonnet-4-20250514",
  messages: [
    { role: "system", content: SCRATCHPAD_SYSTEM_PROMPT },
    { role: "user", content: "请帮我写一个Python快速排序的实现，要能处理重复元素" },
  ],
});

// LLM 输出（示意）:
// <scratchpad>
// 1. 用户要一个快速排序实现，关键要求是处理重复元素
// 2. 我需要：标准快排逻辑 + 重复元素处理策略（三路划分）
// 3. 不确定：用户是否需要原地排序还是返回新数组？先假设返回新数组
// 4. 大纲：标准版 → 三路划分版 → 复杂度分析
// </scratchpad>
// [然后输出真正的代码]
```

**优点**: 零代码实现，Prompt 层面搞定
**缺点**: 占输出 token（但通常值得）；无法保证 LLM 一定遵守格式

#### 方式B：两阶段调用（分离思考与输出）

```typescript
/**
 * 两阶段 Scratchpad：
 * Phase 1: 让 LLM 只思考，不输出最终答案
 * Phase 2: 把思考结果注入上下文，让 LLM 基于此输出答案
 */
async function scratchpadTwoPhase(
  client: OpenAI,
  userQuestion: string
): Promise<{ thinking: string; answer: string }> {
  // ——— Phase 1: 只思考，不回答 ———
  const thinkResponse = await client.chat.completions.create({
    model: "claude-sonnet-4-20250514",
    messages: [
      {
        role: "system",
        content: `你是一个分析助手。你现在只需要分析问题——不要回答问题本身。

请在以下方面分析用户的问题：
1. 问题的核心是什么？
2. 需要哪些知识/信息？
3. 有哪些潜在陷阱/歧义？
4. 回答的结构框架应该是什么？

重要：不要输出答案，只输出分析。`,
      },
      { role: "user", content: userQuestion },
    ],
    temperature: 0.3,  // 分析阶段用低温度，保证稳定性
  });

  const thinking = thinkResponse.choices[0].message.content!;

  // ——— Phase 2: 基于思考输出答案 ———
  const answerResponse = await client.chat.completions.create({
    model: "claude-sonnet-4-20250514",
    messages: [
      {
        role: "system",
        content: `你是一个专业的助手。请基于你对问题的分析，给出最终答案。

## 你的分析结果
${thinking}

## 要求
- 直接回答，不要再重复分析过程
- 语言清晰，结构完整
- 如果分析中标记了不确定的地方，回答中要诚实说明`,
      },
      { role: "user", content: userQuestion },
    ],
    temperature: 0.7,  // 输出阶段可以适当高温度增加表达多样性
  });

  return {
    thinking,
    answer: answerResponse.choices[0].message.content!,
  };
}
```

**优点**: 思考质量高，不会被"急着输出答案"干扰
**缺点**: 多一次 API 调用（成本加倍），延迟加倍

#### 方式C：Agent 的 Working Memory（生产环境最常用）

```typescript
/**
 * Agent 的工作记忆（Scratchpad 的工程化版本）
 * 每次执行操作前，先写一条"思考笔记"，存入上下文
 */
interface WorkingMemoryEntry {
  type: "thought" | "plan" | "observation" | "question";
  content: string;
  timestamp: number;
}

class AgentWorkingMemory {
  private entries: WorkingMemoryEntry[] = [];
  private maxEntries: number = 20;  // 防止无限增长

  /** 添加一条工作笔记 */
  add(type: WorkingMemoryEntry["type"], content: string): void {
    this.entries.push({ type, content, timestamp: Date.now() });
    // 保持最近 N 条
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  /** 把工作记忆格式化到 Prompt 中（给 LLM 看） */
  formatForPrompt(): string {
    if (this.entries.length === 0) return "";

    const formatted = this.entries
      .slice(-8)  // 只给 LLM 看最近 8 条
      .map((entry) => {
        const icon = {
          thought: "🤔",
          plan: "📋",
          observation: "👁️",
          question: "❓",
        }[entry.type];
        return `${icon} [${entry.type}] ${entry.content}`;
      })
      .join("\n");

    return `## 工作记忆 (Working Memory)\n${formatted}\n\n---\n`;
  }

  /** 清空工作记忆（开始新任务时） */
  clear(): void {
    this.entries = [];
  }

  /** 获取摘要（给下一步的 LLM 做上下文压缩用） */
  getSummary(): string {
    return this.entries
      .map((e) => `[${e.type}] ${e.content.slice(0, 100)}`)
      .join(" | ");
  }
}

// === 使用示例：一个 ReAct Agent 的工作流程 ===
async function reactWithScratchpad(userTask: string): Promise<string> {
  const memory = new AgentWorkingMemory();
  const messages: Array<{ role: string; content: string }> = [
    { role: "user", content: userTask },
  ];

  for (let step = 0; step < 10; step++) {
    // Step 1: 把工作记忆拼入 Prompt
    const memoryContext = memory.formatForPrompt();

    // Step 2: LLM 决定下一步（思考 + 行动）
    const response = await client.chat.completions.create({
      model: "claude-sonnet-4-20250514",
      messages: [
        {
          role: "system",
          content: `你是一个自主 Agent。每次回复时：

1. 先写你的思考/计划在工作记忆
2. 如果需要调用工具，输出 TOOL: <工具名> <参数>
3. 如果任务完成，输出 FINAL: <最终答案>

${memoryContext}`,
        },
        ...messages,
      ],
    });

    const content = response.choices[0].message.content!;

    // Step 3: 解析 LLM 输出
    if (content.startsWith("FINAL:")) {
      return content.replace("FINAL:", "").trim();
    }

    if (content.startsWith("TOOL:")) {
      const toolResult = await executeTool(content);  // 执行工具
      memory.add("observation", `工具结果: ${toolResult}`);
      messages.push(
        { role: "assistant", content },
        { role: "user", content: `工具结果: ${toolResult}` }
      );
    } else {
      // LLM 在思考中
      memory.add("thought", content);
      messages.push({ role: "assistant", content });
    }
  }

  return "任务超时未完成";
}
```

### 1.3 Scratchpad 最佳实践总结

| 场景 | 推荐方式 | 理由 |
|------|----------|------|
| 简单的"想清楚再答" | 方式A（Prompt分隔） | 零成本，效果够用 |
| 复杂推理/数学题 | 方式B（两阶段） | 思考不被输出压力干扰 |
| Agent 多步任务 | 方式C（Working Memory） | 结构化、可审计、可控 |
| 客户服务 | 方式A（隐藏scratchpad） | 用户看不到思考，体验干净 |
| 代码审查 | 方式B/C | 需要仔细分析，值得多一次调用 |

---

## 2. 长上下文路由（Long Context Routing）

### 2.1 核心问题

你有一个 AI 应用。用户发来的内容可能是：
- 一句话："你好"（10 tokens）
- 一段代码（500 tokens）
- 一篇论文（15000 tokens）
- 一本小说（200000 tokens）

**一刀切策略行不通**：
- 都用 RAG → 短问题也被拆块检索，慢且可能丢失上下文
- 都塞进上下文 → 长文档超出限制，或者成本爆炸
- 都用同一个模型 → 简单问题浪费好模型，复杂问题小模型搞不定

### 2.2 路由决策框架

```typescript
/**
 * 长上下文路由器：根据输入长度和复杂度，自动选择最优策略
 *
 * 决策矩阵：
 * ┌─────────────┬──────────────┬──────────────┬─────────────────┐
 * │ 输入长度     │ 简单任务     │ 中等复杂度   │ 复杂任务         │
 * ├─────────────┼──────────────┼──────────────┼─────────────────┤
 * │ < 4K tokens │ 直接全量+快模型│ 直接全量+好模型│ 直接全量+最强模型 │
 * │ 4K-32K      │ RAG+快模型   │ RAG+好模型   │ 全量+长上下文模型 │
 * │ 32K-128K    │ RAG+好模型   │ 全量+长上下文 │ 全量+最强长模型  │
 * │ > 128K      │ RAG+切分     │ 切分+分批处理 │ 分批+最强模型    │
 * └─────────────┴──────────────┴──────────────┴─────────────────┘
 */
class LongContextRouter {
  // 模型分段（按能力和上下文窗口）
  private static readonly MODEL_TIERS = {
    cheap_fast: { model: "claude-3-5-haiku-20241022", contextLimit: 200_000, costPer1K: 0.0008 },
    balanced: { model: "claude-sonnet-4-20250514", contextLimit: 200_000, costPer1K: 0.003 },
    best: { model: "claude-sonnet-4-20250514", contextLimit: 200_000, costPer1K: 0.003 },
    ultra_long: { model: "gemini-2.5-pro", contextLimit: 1_000_000, costPer1K: 0.00125 },
  };

  /**
   * 路由决策函数
   * @param inputTokens 输入 token 数
   * @param complexity 任务复杂度（由预估模型评估或规则判断）
   */
  route(
    inputTokens: number,
    complexity: "simple" | "medium" | "complex"
  ): {
    strategy: "direct" | "rag" | "chunked" | "batched";
    model: string;
    estimatedCost: number;
    reason: string;  // 为什么选这个策略
  } {
    // === 决策逻辑 ===

    // 情况1: 短输入 — 直接用最合适的模型
    if (inputTokens < 4_000) {
      const modelMap = {
        simple: this.MODEL_TIERS.cheap_fast,
        medium: this.MODEL_TIERS.balanced,
        complex: this.MODEL_TIERS.best,
      };
      const tier = modelMap[complexity];
      return {
        strategy: "direct",
        model: tier.model,
        estimatedCost: inputTokens * tier.costPer1K,
        reason: "输入短，直接全量处理更快更准，RAG反而增加延迟和检索误差",
      };
    }

    // 情况2: 中等长度 + 简单/中等任务 — RAG
    if (inputTokens < 32_000 && complexity !== "complex") {
      return {
        strategy: "rag",
        model: this.MODEL_TIERS.balanced.model,
        estimatedCost: 3000 * this.MODEL_TIERS.balanced.costPer1K,  // 检索后约3K
        reason: "用RAG检索最相关段落，减少90%无效上下文，同时保证精度",
      };
    }

    // 情况3: 中等长度 + 复杂任务 — 全量保留
    if (inputTokens < 32_000 && complexity === "complex") {
      return {
        strategy: "direct",
        model: this.MODEL_TIERS.best.model,
        estimatedCost: inputTokens * this.MODEL_TIERS.best.costPer1K,
        reason: "复杂任务需要完整上下文理解，分块可能导致信息碎片化",
      };
    }

    // 情况4: 长输入 — 切分+分批
    if (inputTokens < 128_000) {
      return {
        strategy: "chunked",
        model: this.MODEL_TIERS.best.model,
        estimatedCost: inputTokens * this.MODEL_TIERS.best.costPer1K * 1.5,  // 分批有额外开销
        reason: "文档较长，按章节/语义切分后分批处理，每批保留局部完整上下文",
      };
    }

    // 情况5: 超长输入 — 分批+长上下文模型
    return {
      strategy: "batched",
      model: this.MODEL_TIERS.ultra_long.model,
      estimatedCost: inputTokens * this.MODEL_TIERS.ultra_long.costPer1K,
      reason: "使用超长上下文模型（1M tokens），分批处理避免注意力衰减",
    };
  }
}
```

### 2.3 复杂度评估

怎么判断任务是"简单"还是"复杂"？不能全靠猜：

```typescript
/**
 * 用简单的规则 + 轻量 LLM 调用判断任务复杂度
 */
async function assessComplexity(userInput: string): Promise<"simple" | "medium" | "complex"> {
  // === 启发式规则（零成本，先过滤大部分） ===

  // 简单任务特征
  const simplePatterns = [
    /^(你好|hi|hello)/i,        // 打招呼
    /^(是|否|对|不对)/,           // 简单的确认
    /翻译/,                       // 翻译任务
    /总结/,                       // 摘要（结构化好的文本）
    /什么(是|叫).{0,10}\?/,      // 简单定义问题
  ];
  if (simplePatterns.some((p) => p.test(userInput))) {
    return "simple";
  }

  // 复杂任务特征
  const complexPatterns = [
    /(比较|对比|分析).{5,}(和|与|vs)/,  // 多对象比较分析
    /(为什么|原因|原理).{10,}/,          // 深层原因追问
    /(设计|架构|方案|选型).{5,}/,        // 需要决策的设计问题
    /(帮我写|实现|开发).{20,}/,          // 长代码生成
    /(优化|改进|重构).{10,}/,            // 改进已有内容
    /数学|证明|推导/,                     // 数学推理
  ];
  if (complexPatterns.some((p) => p.test(userInput))) {
    return "complex";
  }

  // === 轻量 LLM 评估（规则不明确的中间情况） ===
  // 用 Haiku（最快最便宜）做复杂度判断
  const response = await cheapClient.chat.completions.create({
    model: "claude-3-5-haiku-20241022",
    messages: [
      {
        role: "system",
        content: `评估以下用户问题的复杂度。只输出一个词：

- simple: 常识问答、简单翻译、闲聊、单一事实查询
- medium: 需要一定的分析或解释
- complex: 需要深度推理、多步骤分析、或专业领域知识

只输出 simple / medium / complex，不要其他内容。`,
      },
      { role: "user", content: userInput.slice(0, 500) },  // 只取前500字符判断
    ],
    max_tokens: 10,
    temperature: 0,
  });

  return response.choices[0].message.content!.trim() as "simple" | "medium" | "complex";
}
```

### 2.4 长上下文路由的完整流水线

```typescript
/**
 * 完整的智能路由流水线
 */
async function smartRoutePipeline(
  userInput: string,
  documents?: string[]  // 可选的关联文档
): Promise<string> {
  // Step 1: 计算 token 数
  const inputTokens = countTokens(userInput);
  const docTokens = documents ? countTokens(documents.join("\n")) : 0;
  const totalTokens = inputTokens + docTokens;

  // Step 2: 评估复杂度
  const complexity = await assessComplexity(userInput);

  // Step 3: 路由决策
  const router = new LongContextRouter();
  const decision = router.route(totalTokens, complexity);

  console.log(
    `[Router] ${totalTokens} tokens, ${complexity} complexity → ` +
    `${decision.strategy} + ${decision.model} (¥${decision.estimatedCost.toFixed(4)})`
  );
  console.log(`[Router] 决策理由: ${decision.reason}`);

  // Step 4: 按策略执行
  let answer: string;
  switch (decision.strategy) {
    case "direct":
      // 直接全量发送给模型
      answer = await callLLM(decision.model, [
        { role: "user", content: documents ? `${documents.join("\n")}\n\n${userInput}` : userInput },
      ]);
      break;

    case "rag":
      // 检索最相关的内容
      const relevantChunks = await vectorStore.search(userInput, 5);
      const context = relevantChunks.map((c) => c.pageContent).join("\n\n");
      answer = await callLLM(decision.model, [
        { role: "user", content: `参考资料:\n${context}\n\n问题: ${userInput}` },
      ]);
      break;

    case "chunked":
      // 分块处理（逐块分析，最后汇总）
      const chunks = splitIntoChunks(documents?.join("\n") || userInput, 8_000);
      const chunkResults: string[] = [];
      for (const chunk of chunks) {
        const result = await callLLM(decision.model, [
          { role: "user", content: `请分析以下内容:\n${chunk}\n\n分析要点：${userInput}` },
        ]);
        chunkResults.push(result);
      }
      // 汇总
      answer = await callLLM(decision.model, [
        {
          role: "user",
          content: `请汇总以下分析结果:\n${chunkResults.join("\n\n---\n\n")}\n\n原始问题: ${userInput}`,
        },
      ]);
      break;

    case "batched":
      // 多批并行 + 长上下文模型
      answer = await processBatch(decision.model, userInput, documents);
      break;

    default:
      throw new Error(`未知策略: ${decision.strategy}`);
  }

  return answer;
}
```

### 2.5 路由策略选择速查

| 场景 | 推荐策略 | 为什么 |
|------|----------|--------|
| 用户问"你好" | 直接+快模型 | 零推理，3K上下文浪费<br>Haiku 10ms 响应，成本忽略不计 |
| 问"退换货政策" | RAG+中模型 | 从知识库检索政策文档<br>只需要2-3段，不要全文 |
| 审阅一篇合同 | 全量+好模型 | 合同逻辑需要全局理解<br>拆分会丢失条款间的关联 |
| 分析长篇论文 | 分块+汇总 | 每章独立分析 → 汇总洞察<br>比全量塞入一个窗口更有效 |
| 总结一本书 | 分块+分批 | 100K+的书籍无法一次处理<br>按章节分批，最后总结合并 |
| 代码库级别审查 | RAG+分块 | 用RAG找相关文件 → 针对性分析<br>不必审查整个仓库 |

---

## 3. 记忆压缩（Memory Compression）

> 08-上下文管理.md 中已经讲了**分层记忆架构**，这里深入讲**压缩技术本身**。

### 3.1 记忆压缩的本质

记忆压缩本质上是**在信息量和 token 成本之间做权衡**。你要决定：

- 保留什么？（关键决策、用户偏好、事实数据）
- 丢弃什么？（闲聊、重复内容、已解决的问题）
- 用多少 token？（压缩率越高，信息损失越大）

### 3.2 五种压缩策略

```
压缩策略光谱（从无损到高损）:

级联引用 ←──────────────→ 摘要
(无损)                      (高压缩率)

1. 级联引用 (Reference)     — 不压缩，存指针
2. 关键片段提取 (Extraction) — 只保留相关句子
3. 结构化摘要  (Structured)  — 填模板
4. 自由摘要    (Free-form)   — LLM自由压缩
5. 增量摘要    (Incremental) — 持续更新摘要
```

#### 策略1：级联引用（零信息损失）

不压缩内容，只在当前上下文中存一个"指针"，需要时再加载：

```typescript
/**
 * 级联引用：只在上下文中保留摘要+ID，
 * 需要详细信息时通过 ID 从外存加载
 */
interface CascadeReference {
  id: string;
  summary: string;        // 一句话摘要（给LLM做判断用）
  storageKey: string;     // 外存中的完整内容位置
  importance: "high" | "medium" | "low";
}

class CascadeMemory {
  private references: CascadeReference[] = [];
  private fullContentStore: Map<string, string> = new Map();  // 完整内容存这里

  /** 存入外存，只保留引用 */
  store(fullContent: string, summary: string): string {
    const id = crypto.randomUUID();
    this.fullContentStore.set(id, fullContent);
    this.references.push({
      id,
      summary,
      storageKey: id,
      importance: "medium",
    });
    return id;
  }

  /** 构建给 LLM 看的上下文（只包含引用，不包含完整内容） */
  buildLightweightContext(): string {
    if (this.references.length === 0) return "";
    const refText = this.references
      .slice(-10)  // 最近 10 条
      .map((r, i) => `[${i + 1}] ${r.summary}`)
      .join("\n");
    return `## 可用参考资料（按需查阅）\n${refText}\n\n如需查看完整内容，请说"查看[编号]"`;
  }

  /** 当 LLM 说"查看[3]"时，加载完整内容 */
  loadFullContent(refIndex: number): string | null {
    const ref = this.references[refIndex - 1];
    if (!ref) return null;
    return this.fullContentStore.get(ref.id) || null;
  }
}

// 使用场景：Agent 有 100 篇参考文档，不可能全塞 Prompt
// 给 LLM 看的是"文章标题列表"，它说"查看第3篇"，你再去加载
```

**优点**: 信息零损失
**缺点**: 需要多轮交互（LLM 要求加载 → 你加载 → 再次调用 LLM）
**适用**: 文档库很大但每篇可能很重要的场景

#### 策略2：关键片段提取

从长内容中只提取与当前问题相关的句子：

```typescript
/**
 * 用 LLM 做关键片段提取：不是总结，而是挑出跟问题有关的原文句子
 * 这比"摘要"更可靠——因为是原文，不会引入 LLM 的重新表述误差
 */
async function extractRelevantSentences(
  fullText: string,
  userQuery: string,
  maxSentences: number = 5
): Promise<string> {
  const response = await client.chat.completions.create({
    model: "claude-3-5-haiku-20241022",  // 用快速模型，这类提取任务够用
    messages: [
      {
        role: "user",
        content: `## 任务
从以下文档中，找出与用户问题最相关的句子。不要改写，保留原文。

## 规则
- 最多选择 ${maxSentences} 个句子
- 必须保留原文措辞，不要总结
- 如果某句与问题无关，跳过
- 如果没有相关句子，回复"无相关信息"

## 文档
${fullText.slice(0, 5000)}

## 用户问题
${userQuery}

## 相关句子（原文）`,
      },
    ],
    max_tokens: 500,
    temperature: 0,  // 提取任务要确定性
  });

  return response.choices[0].message.content!;
}
```

**优点**: 准确性高，保留了原文；速度快（用 Haiku 即可）
**缺点**: 可能漏掉隐含相关的信息
**适用**: RAG 中从检索到的文档块中进一步精简

#### 策略3：结构化摘要（推荐）

不让 LLM 自由总结，而是让它按预定义的模板填充——这样摘要更可控、更易检索：

```typescript
/**
 * 结构化摘要：用固定模板压缩信息
 * 
 * 核心思想：
 * - 自由摘要的问题是"LLM 觉得什么重要就留什么"
 * - 结构化摘要要求它按固定维度填——不遗漏关键信息
 */
interface StructuredSummary {
  topic: string;           // 主题
  keyFacts: string[];      // 关键事实（可验证、不含糊）
  decisions: string[];     // 已做出的决策
  userPreferences: string[]; // 用户的偏好/要求
  pendingQuestions: string[]; // 未解决的问题
  searchKeywords: string[];   // 以后检索这段记忆用的关键词
}

async function generateStructuredSummary(
  conversation: Array<{ role: string; content: string }>
): Promise<StructuredSummary> {
  // 将对话格式化为文本
  const conversationText = conversation
    .map((m) => `${m.role === "user" ? "用户" : "AI"}: ${m.content}`)
    .join("\n");

  const response = await client.chat.completions.create({
    model: "claude-3-5-haiku-20241022",
    messages: [
      {
        role: "user",
        content: `请分析以下对话，提取结构化摘要。JSON格式：

${JSON_STRUCTURE}
- topic: 对话的核心主题（1句话）
- keyFacts: 对话中确认的关键事实列表（每条完整句子，可独立理解）
- decisions: 已达成的决策（如果有）
- userPreferences: 用户表达的偏好或要求
- pendingQuestions: 尚未回答或解决的用户问题
- searchKeywords: 5-10个检索关键词，用于以后查找这段记忆

## 对话
${conversationText}

## JSON 输出`,
      },
    ],
    response_format: { type: "json_object" },  // 强制JSON输出
    temperature: 0,
  });

  return JSON.parse(response.choices[0].message.content!) as StructuredSummary;
}

// 对比：自由摘要 vs 结构化摘要
//
// 自由摘要（200 tokens）:
// "用户想实现一个文件上传功能，讨论了进度条显示、大文件分片上传、
//  retry机制。用户倾向用React+TypeScript实现。"
// → 问题: "进度条"怎么实现的？"retry"是什么策略？信息模糊
//
// 结构化摘要（400 tokens, 但信息完整）:
// {
//   "topic": "实现React文件上传组件",
//   "keyFacts": [
//     "需要支持最大100MB文件上传",
//     "进度条用XMLHttpRequest的progress事件实现",
//     "大文件用10MB分片上传，断点续传用localStorage记录切片状态"
//   ],
//   "decisions": ["技术栈: React + TypeScript + Ant Design"],
//   "pendingQuestions": ["上传失败的重试策略：指数退避还是固定间隔？"],
//   "searchKeywords": ["文件上传", "React", "分片", "断点续传", "进度条"]
// }
// → 信息完整，模糊的地方一目了然
```

**优点**: 信息结构化，可搜索，不会遗漏关键维度
**缺点**: 模板设计需要适配不同场景
**适用**: 对话摘要、会议记录、知识提取

#### 策略4：增量摘要（Rolling Summary）

见 `08-上下文管理-Context-Management.md` 第 3.3 节——每次新对话触发摘要更新。

#### 策略5：Token 级压缩（LLMLingua）

用一个小模型对 Prompt 做 token 级别的"无损"压缩：

```typescript
// LLMLingua 是微软的 Prompt 压缩框架（Python 库）
// 原理：用小模型计算每个 token 的"信息量"，移除不重要的 token
// 效果：3-5x 压缩率，质量损失 <5%

// Node.js 中调用 LLMLingua API 服务
async function compressWithLLMLingua(
  prompt: string,
  compressionRatio: number = 0.3  // 压缩率 30%
): Promise<string> {
  const response = await fetch("http://localhost:5000/compress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      target_token: Math.floor(countTokens(prompt) * compressionRatio),
    }),
  });
  const data = await response.json();
  return data.compressed_prompt;
}

// 使用示例
const originalPrompt = "你是一个..." + "很长的背景说明".repeat(50);
const compressed = await compressWithLLMLingua(originalPrompt, 0.3);
// 压缩前后: 5000 tokens → 1500 tokens
// 用法：压缩后的 Prompt 的语义基本保留，LLM 仍能理解

// 注意：LLMLingua 依赖 Python，Node.js 需要自建 API 服务包装
// 开源地址: https://github.com/microsoft/LLMLingua
```

### 3.3 压缩策略选择指南

```
你的需求是什么？
├── 绝对不能丢信息（如法律场景）
│   └── 策略1: 级联引用
│
├── 需要快速检索（如对话历史搜索）
│   └── 策略3: 结构化摘要
│
├── 长对话定期压缩
│   └── 策略4: 增量摘要（详见 08-上下文管理）
│
├── RAG 中精简检索结果
│   └── 策略2: 关键片段提取
│
└── Prompt 本身太长（如 System Prompt）
    └── 策略5: LLMLingua Token 级压缩
```

---

## 4. 三者组合：一个完整的记忆管理方案

```typescript
/**
 * 综合使用 Scratchpad + 长上下文路由 + 记忆压缩
 * 这是一个"高级 AI 应用"的记忆管理框架
 */
class AdvancedAIMemorySystem {
  private workingMemory: AgentWorkingMemory;      // Scratchpad（见 1.2 方式C）
  private router: LongContextRouter;               // 长上下文路由（见 2.2）
  private structuredSummaries: StructuredSummary[]; // 结构化记忆（见 3.2 策略3）
  private cascadeRefs: CascadeMemory;              // 引用存储（见 3.2 策略1）

  constructor() {
    this.workingMemory = new AgentWorkingMemory();
    this.router = new LongContextRouter();
    this.structuredSummaries = [];
    this.cascadeRefs = new CascadeMemory();
  }

  /**
   * 处理用户输入的完整流程
   */
  async process(userInput: string): Promise<string> {
    // ——— Step 1: 工作记忆 ———
    // 记录用户问题到 scratchpad
    this.workingMemory.add("question", userInput);

    // ——— Step 2: 评估上下文 ———
    const tokens = countTokens(userInput);
    const complexity = await assessComplexity(userInput);

    // ——— Step 3: 路由决策 ———
    const decision = this.router.route(tokens, complexity);
    this.workingMemory.add("plan", `策略: ${decision.strategy}, 模型: ${decision.model}`);

    // ——— Step 4: 构建上下文 ———
    // 根据决策选择不同的记忆内容
    let memoryContext = "";

    if (decision.strategy === "direct") {
      // 直接模式：工作记忆 + 最近的摘要
      memoryContext = this.workingMemory.formatForPrompt();
    } else if (decision.strategy === "rag") {
      // RAG 模式：工作记忆 + 结构化摘要（方便检索）
      const relevant = this.structuredSummaries
        .filter((s) => s.searchKeywords.some((kw) => userInput.includes(kw)))
        .slice(0, 3);
      memoryContext = this.workingMemory.formatForPrompt() +
        "\n" + relevant.map((s) => `[历史记忆] ${s.topic}: ${s.keyFacts.join("; ")}`).join("\n");
    }

    // ——— Step 5: 执行并获取回答 ———
    const answer = await this.executeWithStrategy(
      decision.strategy,
      decision.model,
      userInput,
      memoryContext
    );

    // ——— Step 6: 更新记忆 ———
    // 将本轮对话压缩为结构化摘要
    const newSummary = await generateStructuredSummary([
      { role: "user", content: userInput },
      { role: "assistant", content: answer },
    ]);
    this.structuredSummaries.push(newSummary);

    // 清理旧摘要（只保留最近 N 条）
    if (this.structuredSummaries.length > 20) {
      this.structuredSummaries = this.structuredSummaries.slice(-20);
    }

    return answer;
  }

  private async executeWithStrategy(
    strategy: string,
    model: string,
    query: string,
    memoryContext: string
  ): Promise<string> {
    // ... 实际执行逻辑（见 2.4 的 smartRoutePipeline）
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: `工作记忆:\n${memoryContext}` },
        { role: "user", content: query },
      ],
    });
    return response.choices[0].message.content!;
  }
}
```

---

## 5. 推荐文章与资源

### Scratchpad
- [ReAct 论文](https://arxiv.org/abs/2210.03629) — Scratchpad 的理论基础
- [Anthropic: Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) — 提到了"thinking before acting"
- [Chain-of-Thought 论文](https://arxiv.org/abs/2201.11903) — CoT 和 Scratchpad 的关联

### 长上下文路由
- [Lost in the Middle (Stanford)](https://arxiv.org/abs/2307.03172) — 长上下文中间信息丢失的论文
- [RAG vs Long Context (研究对比)](https://arxiv.org/abs/2407.16833) — RAG 和长上下文模型的效果对比
- [Gemini 1M 上下文使用指南](https://ai.google.dev/gemini-api/docs/long-context)

### 记忆压缩
- [LLMLingua (Microsoft)](https://github.com/microsoft/LLMLingua) — Prompt 压缩框架
- [MemGPT (UC Berkeley)](https://github.com/cpacker/MemGPT) — 给 LLM 的操作系统级记忆管理
- [Mem0](https://github.com/mem0ai/mem0) — 开源 LLM 记忆层框架
- [LangChain Memory 模块](https://js.langchain.com/docs/modules/memory/) — 基础记忆管理

### 综合架构
- [CrewAI Memory System](https://docs.crewai.com/core-concepts/Memory/) — 多 Agent 记忆系统设计
- [AutoGen Memory](https://microsoft.github.io/autogen/docs/topics/memory/) — 微软的记忆管理方案
