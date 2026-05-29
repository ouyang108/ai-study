# 上下文窗口管理 — 解决"上下文过长"问题

## 1. 问题本质

LLM 的上下文窗口(Context Window)是有上限的。当对话越来越长、RAG 检索出的文档越来越多、Agent 执行步骤越来越多时，就会触发：

| 问题 | 表现 |
|------|------|
| **截断** | 超出的内容被丢弃，模型"失忆" |
| **注意力稀释** | 太长的上下文中，模型注意力分散，关键信息被淹没（Lost in the Middle） |
| **成本爆炸** | 每次请求都要为整个上下文付费 |
| **延迟增加** | 上下文越长，推理越慢 |
| **幻觉加剧** | 上下文过长时模型更容易混淆信息 |

## 2. 解决方案总览

```
上下文过长问题
├── 策略1: 压缩上下文（保留核心、丢掉冗余）
├── 策略2: 分层记忆（热/温/冷三层）
├── 策略3: 摘要递归（不断将旧内容压缩为摘要）
├── 策略4: 上下文分块 + 选择性注入
├── 策略5: 使用长上下文模型
├── 策略6: RAG 替代全量上下文
└── 策略7: 结构化上下文管理
```

---

## 3. 策略详解

### 3.1 上下文压缩 — 最直接的方案

```typescript
// 方案：用 LLM 压缩对话历史和文档
class ContextCompressor {
  // 注：llm 实例需要在构造函数中注入，这里假设有一个 LLM 客户端
  private llm: { ask: (prompt: string, maxTokens?: number) => Promise<string> };

  constructor(llm: { ask: (prompt: string, maxTokens?: number) => Promise<string> }) {
    this.llm = llm;
  }

  /** 将长对话历史压缩为结构化摘要 */
  async compressConversation(
    messages: Array<{ role: string; content: string }>,
    maxTokens: number = 2000
  ): Promise<string> {
    const historyText = messages
      .map(
        (m) =>
          `${m.role === "user" ? "用户" : "AI"}: ${m.content.slice(0, 200)}`
      )
      .join("\n");

    const compressPrompt = `请将以下对话历史压缩为简洁的摘要，保留所有关键信息：
- 用户的主要需求和偏好
- 已做出的重要决策
- 关键的事实和结论
- 未完成的任务

对话历史：
${historyText}

压缩摘要（不超过${maxTokens}字）：`;

    return this.llm.ask(compressPrompt, maxTokens);
  }

  /** 对 RAG 检索到的文档做压缩，只保留与问题相关的部分 */
  async compressDocuments(
    docs: Array<{ pageContent: string }>,
    query: string
  ): Promise<string> {
    // 让 LLM 从每篇文档中提取与问题相关的句子
    const compressed: string[] = [];
    for (const doc of docs) {
      const extracted = await this.llm.ask(`
文档内容：${doc.pageContent.slice(0, 3000)}

用户问题：${query}

请从文档中提取与用户问题直接相关的信息。
排除与问题无关的内容。保留原文的表述，不要改写。
如果没有相关信息，回复"无相关信息"。
`);
      if (!extracted.includes("无相关信息")) {
        compressed.push(extracted);
      }
    }
    return compressed.join("\n\n---\n\n");
  }
}
```

**优点**: 直接有效，大部分场景适用
**缺点**: 多一次 LLM 调用，增加延迟和成本；压缩可能丢失细节

### 3.2 分层记忆系统 — 推荐方案

```typescript
import { getEncoding } from "js-tiktoken";

// 定义消息类型
interface Message {
  role: string;
  content: string;
}

interface VectorStoreResult {
  pageContent: string;
}

/**
 * 将上下文分为热/温/冷三层，不同层存储策略不同
 *
 * 热记忆(Hot):  当前对话的最近 N 轮，完整保留 → 存入 LLM 上下文
 * 温记忆(Warm):  本次会话中较早的内容，压缩为摘要 → 按需注入
 * 冷记忆(Cold):  历史会话中的重要信息，向量检索 → RAG 方式召回
 */
class HierarchicalMemory {
  private llm: { ask: (prompt: string) => Promise<string> };
  private vectorStore: { search: (query: string, k: number) => Promise<VectorStoreResult[]> };
  private hotMemory: Message[] = [];      // 最近 10 轮对话，完整内容
  private warmSummary: string = "";        // 当前会话的摘要
  private maxHotRounds: number = 10;       // 热记忆保留轮数

  constructor(
    llm: { ask: (prompt: string) => Promise<string> },
    vectorStore: { search: (query: string, k: number) => Promise<VectorStoreResult[]> }
  ) {
    this.llm = llm;
    this.vectorStore = vectorStore;
  }

  /** 添加新消息 */
  async addMessage(role: string, content: string): Promise<void> {
    this.hotMemory.push({ role, content });

    // 热记忆超出阈值 → 压缩最旧的 N 轮到温记忆
    if (this.hotMemory.length > this.maxHotRounds) {
      const oldMessages = this.hotMemory.slice(0, this.hotMemory.length - this.maxHotRounds);
      this.hotMemory = this.hotMemory.slice(-this.maxHotRounds);

      // 将旧消息合并到摘要中
      this.warmSummary = await this.updateSummary(this.warmSummary, oldMessages);
    }
  }

  /** 增量更新摘要 */
  private async updateSummary(existingSummary: string, newMessages: Message[]): Promise<string> {
    const newText = newMessages
      .map(
        (m) =>
          `${m.role === "user" ? "用户" : "AI"}: ${m.content.slice(0, 200)}`
      )
      .join("\n");

    const summary = await this.llm.ask(`
现有摘要：
${existingSummary || "（无）"}

新增对话：
${newText}

请将新增内容合并到现有摘要中。保留：
- 用户的偏好和需求
- 重要的决策和结论
- 关键事实和数据
- 未解决的问题

合并后的摘要：`);
    return summary;
  }

  /** 构建要发送给 LLM 的上下文 */
  async buildContext(userQuery: string, maxTokens: number = 8000): Promise<string> {
    const parts: string[] = [];

    // 1. 温记忆（当前会话摘要）— 始终包含
    if (this.warmSummary) {
      parts.push(`[会话历史摘要]\n${this.warmSummary}`);
    }

    // 2. 冷记忆（向量检索历史相关对话）— 按需召回
    const relevantHistory = await this.vectorStore.search(userQuery, 3);
    if (relevantHistory.length > 0) {
      const historyText = relevantHistory.map((r) => r.pageContent).join("\n");
      parts.push(`[相关历史对话]\n${historyText}`);
    }

    // 3. 热记忆（最近对话）— 完整保留
    if (this.hotMemory.length > 0) {
      const hotText = this.hotMemory
        .map(
          (m) =>
            `${m.role === "user" ? "用户" : "AI"}: ${m.content}`
        )
        .join("\n");
      parts.push(`[最近对话]\n${hotText}`);
    }

    let context = parts.join("\n\n---\n\n");

    // 4. 兜底：如果仍然超长，裁剪
    if (this.countTokens(context) > maxTokens) {
      context = this.trimToFit(context, maxTokens);
    }

    return context;
  }

  /** 估算 token 数（中文约 1.5 字符/token，英文约 4 字符/token） */
  private countTokens(text: string): number {
    try {
      const enc = getEncoding("cl100k_base");
      return enc.encode(text).length;
    } catch {
      // 粗略估算
      return Math.floor(text.length / 2);
    }
  }

  /** 如果上下文仍超长，从旧到新裁剪 */
  private trimToFit(text: string, maxTokens: number): string {
    const parts = text.split("\n\n---\n\n");
    // 优先保留后面的（更新的），从前面开始裁剪
    const resultParts: string[] = [];
    let tokenCount = 0;

    // 从最新的开始保留
    for (const part of parts.reverse()) {
      const partTokens = this.countTokens(part);
      if (tokenCount + partTokens <= maxTokens) {
        resultParts.unshift(part);
        tokenCount += partTokens;
      } else {
        // 对超出的部分进行截断
        const available = maxTokens - tokenCount;
        const truncated = part.slice(0, available * 2) + "\n[...内容过长，已截断...]";
        resultParts.unshift(truncated);
        break;
      }
    }

    return resultParts.join("\n\n---\n\n");
  }
}
```

**优点**: 模仿人脑记忆机制，新旧兼顾，不会丢失重要历史信息
**缺点**: 实现复杂度较高，摘要质量依赖 LLM 能力

### 3.3 摘要递归（Rolling Summary）— 简单实用

```typescript
/**
 * 原理：始终保持上下文中有"摘要 + 最近N轮完整对话"
 * 相当于不停地"遗忘细节，记住要点"
 */
class RollingSummary {
  private llm: { ask: (prompt: string) => Promise<string> };
  private summaryInterval: number;  // 每 N 轮压缩一次
  private summary: string = "";
  private recentMessages: Message[] = [];

  constructor(
    llm: { ask: (prompt: string) => Promise<string> },
    summaryInterval: number = 8
  ) {
    this.llm = llm;
    this.summaryInterval = summaryInterval;
  }

  async addMessage(role: string, content: string): Promise<void> {
    this.recentMessages.push({ role, content });

    if (this.recentMessages.length >= this.summaryInterval * 2) {
      // 取前一半压缩到摘要，后一半保留
      const toCompress = this.recentMessages.slice(0, this.summaryInterval);
      this.recentMessages = this.recentMessages.slice(this.summaryInterval);

      // 压缩进摘要
      const compressText = toCompress
        .map(
          (m) =>
            `${m.role === "user" ? "用户" : "AI"}: ${m.content.slice(0, 150)}`
        )
        .join("\n");

      this.summary = await this.llm.ask(`
当前摘要：${this.summary || "（无）"}
新增对话：${compressText}
请更新摘要，保留重要信息。新摘要：`);
    }
  }

  /** 获取上下文（摘要 + 最近对话） */
  getContext(): string {
    const parts: string[] = [];
    if (this.summary) {
      parts.push(`[对话摘要]\n${this.summary}`);
    }
    const recent = this.recentMessages
      .map(
        (m) =>
          `${m.role === "user" ? "用户" : "AI"}: ${m.content}`
      )
      .join("\n");
    parts.push(`[最近对话]\n${recent}`);
    return parts.join("\n\n");
  }
}
```

**优点**: 实现简单，上下文大小可控，不会无限增长
**缺点**: 每 N 轮就要多一次 LLM 调用做压缩；细节可能被摘要丢失

### 3.4 上下文分块 + 选择性注入

```typescript
/**
 * 不在上下文中塞入所有内容，而是根据当前问题，
 * 从候选信息中"选择"最相关的部分注入上下文
 */
class SelectiveContextInjector {
  // 注：embed 方法和 cosineSimilarity 函数需要在外部实现或注入
  private embed: (text: string) => Promise<number[]>;

  constructor(embedFn: (text: string) => Promise<number[]>) {
    this.embed = embedFn;
  }

  /** 选择与当前问题最相关的信息块 */
  async selectRelevantContext(
    userQuery: string,
    candidateChunks: string[],
    maxChunks: number = 5
  ): Promise<string[]> {
    // 方法1: 用 Embedding 相似度筛选
    const queryEmbedding = await this.embed(userQuery);
    const scored: Array<{ chunk: string; score: number }> = [];

    for (const chunk of candidateChunks) {
      const chunkEmbedding = await this.embed(chunk);
      const score = this.cosineSimilarity(queryEmbedding, chunkEmbedding);
      scored.push({ chunk, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxChunks).map((item) => item.chunk);

    // 方法2: 用 LLM 打分（更准但更贵）
    // 一次让 LLM 对多个候选打分
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (normA * normB);
  }

  /**
   * 智能构建上下文：
   * - system_prompt: 始终保留（最高优先级）
   * - 工具定义: 始终保留
   * - 对话历史: 选择最近 N 轮 + 相关的旧对话
   * - 知识库: 只注入与当前问题相关的
   */
  async buildSmartContext(
    userQuery: string,
    systemPrompt: string,
    conversationHistory: Message[],
    tools: Array<Record<string, unknown>>,
    knowledgeBase: string[],
    maxTokens: number = 8000
  ): Promise<string> {
    let usedTokens = 0;
    const parts: string[] = [];

    // 优先级1: 系统提示词（不可裁剪）
    parts.push(systemPrompt);
    usedTokens += this.countTokens(systemPrompt);

    // 优先级2: 工具定义（Agent 场景）
    const toolsText = JSON.stringify(tools);
    const toolsTokens = this.countTokens(toolsText);
    if (usedTokens + toolsTokens < maxTokens * 0.3) {
      // 工具最多占 30%
      parts.push(`[可用工具]\n${toolsText}`);
      usedTokens += toolsTokens;
    } else {
      // 工具太多，按相关性筛选
      const selectedTools = await this.selectRelevantTools(userQuery, tools);
      const selectedToolsText = JSON.stringify(selectedTools);
      parts.push(`[可用工具]\n${selectedToolsText}`);
      usedTokens += this.countTokens(selectedToolsText);
    }

    // 优先级3: 相关知识
    let remaining = maxTokens - usedTokens - 1000;  // 留 1000 给回答
    const relevantKnowledge = await this.selectRelevantContext(
      userQuery,
      knowledgeBase,
      3
    );
    for (const kn of relevantKnowledge) {
      const knTokens = this.countTokens(kn);
      if (usedTokens + knTokens < remaining) {
        parts.push(`[参考资料]\n${kn}`);
        usedTokens += knTokens;
      } else {
        break;
      }
    }

    // 优先级4: 对话历史（剩下的空间）
    remaining = maxTokens - usedTokens - 1000;
    const historyText = this.buildHistory(conversationHistory, remaining);
    parts.push(historyText);

    return parts.join("\n\n---\n\n");
  }

  private countTokens(text: string): number {
    return Math.floor(text.length / 2);  // 粗略估算
  }

  private buildHistory(messages: Message[], maxTokens: number): string {
    // 从最新的消息开始，保留到 token 预算用完
    const selected: string[] = [];
    let used = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const text = `${messages[i].role === "user" ? "用户" : "AI"}: ${messages[i].content}`;
      const tokens = this.countTokens(text);
      if (used + tokens <= maxTokens) {
        selected.unshift(text);
        used += tokens;
      } else {
        break;
      }
    }
    return selected.join("\n");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async selectRelevantTools(
    _userQuery: string,
    tools: Array<Record<string, unknown>>
  ): Promise<Array<Record<string, unknown>>> {
    // 简化实现：按名称相关性选择工具
    // 实际项目中可使用 Embedding 相似度或 LLM 打分
    return tools.slice(0, 5);  // 最多保留 5 个最相关的工具
  }
}
```

**优点**: 精细控制，每条信息都有"入选理由"
**缺点**: 选择过程本身有成本；选择错误可能漏掉关键信息

### 3.5 直接使用长上下文模型 — 最简单

```typescript
// 如果预算允许，直接用长上下文模型，最简单
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // Claude 系列
  "claude-sonnet-4-20250514": 200_000,  // 示例快照 ID，实际上下文以控制台为准
  "claude-3-5-haiku-20241022": 200_000,
  // GPT 系列
  "gpt-4o":                 128_000,
  "gpt-4-turbo":            128_000,
  "gpt-3.5-turbo-16k":      16_000,
  // Gemini 系列
  "gemini-2.5-pro":         1_000_000,  // 100 万 tokens！
  "gemini-2.5-flash":       1_000_000,
  // 国内模型
  "qwen3-235b":             128_000,
  "deepseek-v3":            128_000,
  "kimi-k2":                128_000,
  "glm-4":                  128_000,
};

/** 根据上下文大小、预算、质量要求选择合适的模型 */
function chooseModel(contextSize: number, budget: number, quality: string): string {
  if (contextSize > 500_000) {
    return "gemini-2.5-pro";  // 唯一选择
  } else if (contextSize > 100_000) {
    if (budget < 0.01) {       // 极低预算
      return "gemini-2.5-flash";  // 便宜且 100 万上下文
    } else {
      return "claude-sonnet-4-20250514";  // 示例快照 ID，生产中以官方最新 ID 为准
    }
  } else if (contextSize > 30_000) {
    return quality === "high" ? "gpt-4o" : "deepseek-v3";
  } else {
    return "deepseek-v3";  // 短上下文用性价比最高的
  }
}
```

**优点**: 零开发成本，直接调大 `max_tokens` 参数即可
**缺点**: 成本高；长上下文时"Lost in the Middle"效应更明显；注意力分散导致质量下降

### 3.6 RAG 替代全量上下文

```typescript
// 核心思想：不在上下文中放原始文档，而是只放检索到的相关片段
// 详见 06-检索增强生成-RAG.md

// 对比：
// ❌ 方案A：把整个 PDF (500页) 塞进上下文 → 20 万 tokens → 贵且效果差
// ✅ 方案B：检索出与问题最相关的 3 个段落 → 2000 tokens → 便宜且准确
```

---

## 4. 方案对比总结

| 方案 | 实现难度 | 成本 | 效果 | 适用场景 |
|------|----------|------|------|----------|
| 长上下文模型 | ★☆☆☆☆ | 高 | 中（注意力稀释） | 偶尔超长，预算足 |
| 摘要递归 | ★★☆☆☆ | 中（额外LLM调用） | 中上 | 长对话，多轮交互 |
| 上下文压缩 | ★★☆☆☆ | 中 | 中 | 单次 RAG 文档过多 |
| 分层记忆 | ★★★★☆ | 中 | 高 | Agent 长期运行 |
| 选择性注入 | ★★★☆☆ | 低 | 高 | RAG 场景最佳 |
| RAG替代全量 | ★★☆☆☆ | 低 | 高 | 知识问答场景 |

---

## 5. 最佳实践组合

```typescript
import { getEncoding } from "js-tiktoken";

/**
 * 鲁棒的上下文管理器，综合多种策略
 *
 * 推荐：分层记忆 + 选择性注入 + 长上下文兜底
 */
class RobustContextManager {
  private memory: HierarchicalMemory;           // 分层记忆
  private injector: SelectiveContextInjector;   // 选择性注入
  private maxTokens: number = 150_000;          // 使用长上下文模型兜底
  private systemPrompt: string;
  private tools: Array<Record<string, unknown>>;
  private knowledgeBase: string[];
  private defaultModel: string;

  constructor(
    memory: HierarchicalMemory,
    injector: SelectiveContextInjector,
    systemPrompt: string,
    tools: Array<Record<string, unknown>>,
    knowledgeBase: string[],
    defaultModel: string = "gpt-4o"
  ) {
    this.memory = memory;
    this.injector = injector;
    this.systemPrompt = systemPrompt;
    this.tools = tools;
    this.knowledgeBase = knowledgeBase;
    this.defaultModel = defaultModel;
  }

  /** 综合策略构建最优上下文 */
  async prepareContext(userQuery: string): Promise<{
    context: string;
    model: string;
    warning?: string;
  }> {
    // Step 1: 用分层记忆管理对话历史
    const memoryContext = await this.memory.buildContext(userQuery);

    // Step 2: 用选择性注入管理外部知识
    const knowledgeContext = await this.injector
      .selectRelevantContext(userQuery, this.knowledgeBase);

    // Step 3: 组合
    const fullContext = this.combine(
      memoryContext,
      knowledgeContext
    );

    // Step 4: 如果超出模型限制，按优先级裁剪
    let context = fullContext;
    if (this.countTokens(fullContext) > this.maxTokens) {
      context = this.priorityTrim(fullContext);
    }

    // Step 5: 如果仍然超长，用长上下文模型兜底
    if (this.countTokens(context) > this.maxTokens) {
      return {
        context,
        model: "gemini-2.5-pro",  // 切换到超长上下文模型
        warning: "上下文较长，可能影响响应质量",
      };
    }

    return { context, model: this.defaultModel };
  }

  private combine(memoryContext: string, knowledgeContext: string): string {
    const parts: string[] = [this.systemPrompt];

    const toolsText = JSON.stringify(this.tools);
    parts.push(`[可用工具]\n${toolsText}`);

    if (knowledgeContext.length > 0) {
      parts.push(`[相关知识]\n${knowledgeContext}`);
    }

    parts.push(memoryContext);

    return parts.join("\n\n---\n\n");
  }

  private countTokens(text: string): number {
    try {
      const enc = getEncoding("cl100k_base");
      return enc.encode(text).length;
    } catch {
      return Math.floor(text.length / 2);
    }
  }

  /**
   * 按优先级裁剪：
   * System Prompt > 最近对话 > 工具定义 > 知识片段 > 旧对话摘要
   */
  private priorityTrim(context: string): string {
    // 简化实现：从末尾开始截断
    const maxChars = this.maxTokens * 2;  // 粗略估算
    if (context.length > maxChars) {
      return context.slice(0, maxChars) + "\n[...上下文过长，已按优先级裁剪...]";
    }
    return context;
  }
}
```

---

## 6. 推荐文章

- [Lost in the Middle (Stanford)](https://arxiv.org/abs/2307.03172) — 论文证明长上下文中间位置信息容易被忽略
- [MemGPT (UC Berkeley)](https://arxiv.org/abs/2310.08560) — 给 LLM 设计操作系统级别的记忆管理
- [MemGPT GitHub](https://github.com/cpacker/MemGPT)
- [Anthropic Context Window Guide](https://docs.anthropic.com/en/docs/build-with-claude/context-windows)
- [OpenAI Token Management](https://platform.openai.com/tokenizer)
