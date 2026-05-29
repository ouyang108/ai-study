# AI 数据工程与应用架构

## 第一部分：AI 数据工程

### 1. 数据是 AI 应用的基础

很多人只关注模型和 Prompt，但**数据质量决定了 AI 应用的天花板**。无论做 RAG、微调还是评估，都需要高质量数据。

### 2. RAG 数据准备全流程

```
原始文档 → 格式清洗 → 结构解析 → 文本切分 → 元数据标注 → 向量化入库
```

#### 2.1 文档解析

```typescript
// 多格式文档解析方案
const PARSERS: Record<string, Record<string, string>> = {
  "PDF": {
    "简单扫描件": "pdf-parse / pdfjs-dist (免费)",
    "复杂排版": "Unstructured.io (开源，推荐，通过 API 调用)",
    "表格密集": "Camelot / Tabula (Python 工具)",
    "学术论文": "GROBID (最专业，HTTP API)",
    "OCR 识别": "PaddleOCR (中文最佳) / Tesseract.js",
    "付费商业": "LlamaParse (最佳质量) / Azure Document Intelligence",
  },
  "Word/PPT/Excel": {
    "mammoth.js / xlsx / officegen",
  },
  "HTML": {
    "cheerio + @mozilla/readability (提取正文)",
  },
  "Markdown": {
    "直接按标题层级切分",
  },
  "图片": {
    "OCR → PaddleOCR / tesseract.js",
  },
};

// Unstructured.io 示例（推荐，支持几十种格式）
// 通过 Unstructured API 调用
async function partitionDocument(filePath: string) {
  const formData = new FormData();

  // 读取文件并附加到表单
  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer]);
  formData.append("files", blob, path.basename(filePath));

  const response = await fetch(
    "https://api.unstructured.io/general/v0/general",
    {
      method: "POST",
      headers: {
        "unstructured-api-key": process.env.UNSTRUCTURED_API_KEY!,
      },
      body: formData,
    }
  );

  const elements = await response.json();

  // 保留文档结构（标题、段落、表格、列表）
  for (const el of elements) {
    console.log(`[${el.type}] ${el.text.slice(0, 100)}...`);
    // [Title] 合同协议书
    // [NarrativeText] 甲方（出租方）：XXX有限公司...
    // [Table] 租金明细表...
  }
}
```

```typescript
// LlamaParse 示例（云端高质量解析，适合复杂 PDF）
// 使用 LlamaParse API
async function parseWithLlamaParse(filePath: string) {
  // 先上传文件获取 job_id
  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer]);

  const formData = new FormData();
  formData.append("file", blob, path.basename(filePath));

  const uploadResponse = await fetch(
    "https://api.cloud.llamaindex.ai/api/parsing/upload",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.LLAMA_CLOUD_API_KEY!}`,
      },
      body: formData,
    }
  );

  const uploadResult = await uploadResponse.json();

  // 轮询获取解析结果
  const jobId = uploadResult.id;
  let result;
  do {
    await new Promise(resolve => setTimeout(resolve, 2000));  // 等待 2 秒
    const statusResponse = await fetch(
      `https://api.cloud.llamaindex.ai/api/parsing/job/${jobId}`,
      {
        headers: {
          "Authorization": `Bearer ${process.env.LLAMA_CLOUD_API_KEY!}`,
        },
      }
    );
    result = await statusResponse.json();
  } while (result.status !== "SUCCESS");

  // 获取 Markdown 格式的解析结果
  const markdownResponse = await fetch(
    `https://api.cloud.llamaindex.ai/api/parsing/job/${jobId}/result/markdown`,
    {
      headers: {
        "Authorization": `Bearer ${process.env.LLAMA_CLOUD_API_KEY!}`,
      },
    }
  );

  const markdown = await markdownResponse.text();
  // 输出保留了表格结构、层级、格式的 Markdown
  return markdown;
}
```

#### 2.2 数据清洗

```typescript
/**
 * 清洗文档内容
 */
function cleanDocument(text: string): string {
  // 1. 移除页眉页脚（通常是重复的）
  text = text.replace(/第\s*\d+\s*页\s*共\s*\d+\s*页/g, "");

  // 2. 移除多余空白
  text = text.replace(/\n{3,}/g, "\n\n");     // 连续 3+ 换行 → 2 个
  text = text.replace(/ {2,}/g, " ");          // 连续空格 → 1 个

  // 3. 修复 PDF 转换常见问题
  text = text.replace(/ﬁ/g, "fi");             // 连字
  text = text.replace(/ﬂ/g, "fl");
  text = text.replace(/(\w)-\n(\w)/g, "$1$2");  // 英文断词连字符

  // 4. 移除空页和水印
  const lines = text.split("\n").filter(l => l.trim());

  return lines.join("\n");
}

/**
 * 过滤低质量的文本块
 */
function filterLowQualityChunks(
  chunks: Array<{ pageContent: string; metadata?: Record<string, any> }>
): Array<{ pageContent: string; metadata?: Record<string, any> }> {
  const qualityChunks: Array<{ pageContent: string; metadata?: Record<string, any> }> = [];

  for (const chunk of chunks) {
    const text = chunk.pageContent.trim();

    // 太短：信息量不够
    if (text.length < 20) continue;

    // 纯数字/符号：非正文
    if (/^[\d\s.,\-+%]+$/.test(text)) continue;

    // 太高的特殊字符比例
    const specialChars = text.match(/[^\w\s\u4e00-\u9fff]/g) || [];
    const specialRatio = specialChars.length / Math.max(text.length, 1);
    if (specialRatio > 0.5) continue;

    qualityChunks.push(chunk);
  }

  return qualityChunks;
}
```

#### 2.3 元数据标注

```typescript
// 好的元数据能显著提升检索质量
/**
 * 为每个文本块添加丰富的元数据
 */
function enrichMetadata(
  chunk: { text: string; metadata: Record<string, any> },
  sourceDoc: {
    filename: string;
    fileType: string;
    pageNumber: number;
    totalPages: number;
    createdDate: string;
    updatedDate: string;
    accessLevel: string;
  }
): { text: string; metadata: Record<string, any> } {
  chunk.metadata = {
    ...chunk.metadata,

    // 来源信息
    source: sourceDoc.filename,
    file_type: sourceDoc.fileType,
    page: sourceDoc.pageNumber,
    total_pages: sourceDoc.totalPages,

    // 内容特征
    char_count: chunk.text.length,
    section_title: chunk.metadata.section || "",  // 所在章节标题（如果有）
    content_type: classifyContent(chunk.text),     // 文本/表格/代码/列表

    // 时效性
    created_date: sourceDoc.createdDate,
    updated_date: sourceDoc.updatedDate,

    // 重要性/权限
    importance: isCriticalContent(chunk.text) ? "high" : "normal",
    access_level: sourceDoc.accessLevel,
  };

  return chunk;
}

/**
 * 自动分类内容类型
 */
function classifyContent(text: string): string {
  if (text.includes("|") && text.split("\n").length <= 2) {
    return "table";
  }
  if (text.startsWith("```") || text.includes("def ") || text.includes("function ")) {
    return "code";
  }
  if (/^\d+[.、]/.test(text)) {
    return "list";
  }
  if (text.length < 100 && text.split("\n").length === 0) {
    return "heading";
  }
  return "text";
}

/**
 * 判断是否关键内容（示例，实际根据业务判断）
 */
function isCriticalContent(text: string): boolean {
  // 包含金额、截止日期、签名等信息视为高重要度
  const criticalPatterns = [/金额/, /截止/, /签名/, /盖章/, /合同/];
  return criticalPatterns.some(p => p.test(text));
}
```

### 3. 微调数据准备

```typescript
// 高质量微调数据的特征
const FINE_TUNING_DATA_REQUIREMENTS = {
  "数量": "最少 50 条，推荐 200-1000 条",
  "多样性": "覆盖各种边界情况，不要都是相似的例子",
  "准确性": "每一条的答案必须准确无误（微调会被'烧录'进模型）",
  "一致性": "相同类型的问题，格式和风格保持一致",
  "代表性": "数据分布要接近真实使用场景的分布",
};

// 数据格式示例
const fineTuningData = [
  {
    messages: [
      {
        role: "system",
        content: "你是公司的技术客服，只回答产品技术问题。语气专业但友好。"
      },
      {
        role: "user",
        content: "你们的API支持并发多少个请求？"
      },
      {
        role: "assistant",
        content: "标准版支持每秒 100 个并发请求，企业版支持 1000 个。\n\n如果您需要更高的并发，可以联系我们的售前团队定制方案。\n\n参考文档：https://docs.example.com/rate-limits"
      }
    ]
  },
  // ... 更多
];

// 数据审查清单
/**
 * 验证微调数据质量
 */
function validateTrainingData(data: Array<{ messages: Array<{ role: string; content: string }> }>): string[] {
  const issues: string[] = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];

    // 检查 1: System Prompt 是否一致
    if (item.messages[0].content !== data[0].messages[0].content) {
      issues.push(`第${i}条: System Prompt 不一致`);
    }

    // 检查 2: 答案是否包含幻觉（编造不存在的链接/信息）
    const answer = item.messages[item.messages.length - 1].content;
    if (answer.includes("http")) {
      if (!isValidUrl(answer)) {  // 检查 URL 格式
        issues.push(`第${i}条: 包含无效链接`);
      }
    }

    // 检查 3: 是否有"作为AI"之类的废话
    const badPhrases = ["作为一个AI", "作为AI助手", "很抱歉我不能"];
    for (const phrase of badPhrases) {
      if (answer.includes(phrase)) {
        issues.push(`第${i}条: 包含'${phrase}'（不需要套话）`);
      }
    }
  }

  return issues;
}

/**
 * 检查 URL 是否格式有效
 */
function isValidUrl(text: string): boolean {
  const urlPattern = /https?:\/\/[^\s"'<>]+/g;
  const matches = text.match(urlPattern);
  if (!matches) return false;
  // 简单格式校验（生产环境可替换为实际的 HTTP HEAD 请求验证）
  return matches.every(url => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  });
}
```

---

## 第二部分：AI 应用架构模式

### 4. 通用 AI 应用架构

```
┌─────────────────────────────────────────────────────────┐
│                      前端层                              │
│   Web App / Mobile / Chatbot / API                      │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                    API 网关层                             │
│   限流 / 认证 / 路由 / 日志 / 成本追踪                    │
│   推荐工具: LiteLLM / One API / Kong / Nginx            │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                   业务逻辑层                              │
│  ┌─────────┐  ┌──────────┐  ┌────────────────────┐    │
│  │ 对话管理 │  │ Agent 编排│  │ RAG Pipeline       │    │
│  │ - 上下文 │  │ - 任务分解│  │ - 检索 → 重排 → 生成│    │
│  │ - 记忆   │  │ - 工具调用│  │ - 引用标注          │    │
│  └─────────┘  └──────────┘  └────────────────────┘    │
│  推荐框架: LangChain.js / LlamaIndexTS / 自研           │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                   数据与模型层                            │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐   │
│  │ LLM API  │  │向量数据库 │  │ 缓存 (Redis)       │   │
│  │ 多模型管理│  │ Milvus   │  │ 语义缓存 + 精确缓存 │   │
│  └──────────┘  │ Chroma   │  └────────────────────┘   │
│                └──────────┘                             │
└─────────────────────────────────────────────────────────┘
```

### 5. 常见架构模式

#### 5.1 简单对话模式

```typescript
// 最基础的模式: 一问一答
// 适合: 简单 Chatbot、内容生成工具

import express from "express";

const app = express();
app.use(express.json());

app.post("/chat", async (req, res) => {
  const { message, history = [] } = req.body;

  const response = await llm.chat([
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: message },
  ]);

  res.json({ reply: response });
});

// 优点: 简单直接，延迟低
// 缺点: 不能查资料（RAG），不能执行操作（Agent）
```

#### 5.2 RAG 模式

```typescript
// 检索 + 生成 模式
// 适合: 知识问答、文档助手、客服知识库

app.post("/rag/chat", async (req, res) => {
  const { query } = req.body;

  // Step 1: 检索相关文档
  const docs = await vectorStore.search(query, 5);

  // Step 2: 重排序
  const rerankedDocs = await reranker.rerank(query, docs);
  const topDocs = rerankedDocs.slice(0, 3);

  // Step 3: 构建 Prompt（Grounding）
  const context = formatDocs(topDocs);
  const prompt = `参考资料:\n${context}\n\n问题: ${query}\n\n基于资料回答:`;

  // Step 4: LLM 生成
  const llmResponse = await llm.chat(prompt);

  res.json({
    reply: llmResponse,
    sources: topDocs.map(doc => doc.metadata),  // 来源追溯
  });
});
```

#### 5.3 Agent 模式

```typescript
// Agent 模式: LLM 自主规划、调用工具、多步执行
// 适合: 复杂任务、自动化操作

import { StateGraph, END, Annotation } from "@langchain/langgraph";

// 定义 Agent 状态
const AgentState = Annotation.Root({
  messages: Annotation<any[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  nextAction: Annotation<string>(),
  toolResults: Annotation<any[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),
  taskDone: Annotation<boolean>({
    reducer: (_, y) => y,
    default: () => false,
  }),
});

/**
 * 思考节点: 分析当前状态，决定下一步动作
 */
async function thinkNode(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
  // LLM 分析当前消息和工具结果，决定下一步
  const plan = await llm.plan(state.messages, state.toolResults);
  return {
    nextAction: plan.nextAction,
    messages: [{ role: "assistant", content: plan.reasoning }],
  };
}

/**
 * 执行节点: 调用具体工具
 */
async function actNode(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
  // 根据 nextAction 调用对应的工具
  const result = await executeTool(state.nextAction, state.messages);
  return { toolResults: [result] };
}

/**
 * 观察节点: 评估工具执行结果
 */
async function observeNode(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
  // 判断任务是否完成
  const lastResult = state.toolResults[state.toolResults.length - 1];
  const done = lastResult?.status === "completed" || state.toolResults.length >= 10;  // 最多 10 步

  return {
    taskDone: done,
    messages: [{ role: "tool", content: JSON.stringify(lastResult) }],
  };
}

/**
 * 回复节点: 生成最终回复
 */
async function respondNode(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
  const finalAnswer = await llm.summarize(state.messages, state.toolResults);
  return {
    messages: [{ role: "assistant", content: finalAnswer }],
  };
}

/**
 * 构建 Agent 状态图
 */
function buildAgentGraph() {
  const graph = new StateGraph(AgentState);

  // 添加节点
  graph.addNode("think", thinkNode);       // 思考下一步做什么
  graph.addNode("act", actNode);           // 执行工具
  graph.addNode("observe", observeNode);   // 观察结果
  graph.addNode("respond", respondNode);   // 最终回复

  // 添加边（路由）
  graph.addEdge("think", "act");
  graph.addEdge("act", "observe");

  // 条件路由: 任务完成 → respond, 否则 → think
  graph.addConditionalEdges(
    "observe",
    (state) => state.taskDone ? "respond" : "think",
    { respond: "respond", think: "think" }
  );

  graph.addEdge("respond", END);

  return graph.compile();
}

// 使用
const agent = buildAgentGraph();
const result = await agent.invoke({
  messages: [{ role: "user", content: "帮我查天气并写报告" }],
});

// 优点: 能处理复杂任务，自动拆解和编排
// 缺点: 多步 LLM 调用，延迟高、成本高；可能死循环
```

#### 5.4 多模型路由模式

```typescript
// 根据任务类型，路由到不同的模型
// 适合: 优化成本和质量的平衡

/**
 * 智能模型路由器
 */
class ModelRouter {
  private rules: Array<{
    name: string;
    pattern?: RegExp;
    hasImage?: boolean;
    model: string;
  }>;
  private defaultModel: string;

  constructor() {
    this.rules = [
      {
        name: "简单分类/情感分析",
        pattern: /(分类|情感|是|否|判断|识别)/,
        model: "claude-3-5-haiku-20241022",  // 示例快照 ID，生产中以官方最新 ID 为准
      },
      {
        name: "代码生成",
        pattern: /(写代码|编程|实现|bug|debug|函数)/,
        model: "claude-sonnet-4-20250514",  // 代码任务示例
      },
      {
        name: "长文档分析",
        pattern: /(分析|总结|概括|全文|文档|报告)/,
        model: "claude-sonnet-4-20250514",  // 长上下文任务示例
      },
      {
        name: "中文创作",
        pattern: /[\u4e00-\u9fff]{20,}/,  // 长中文输入
        model: "deepseek-v3",  // 中文好且便宜
      },
      {
        name: "多模态",
        hasImage: true,
        model: "gpt-4o",  // 多模态最好
      },
    ];
    this.defaultModel = "claude-sonnet-4-20250514";
  }

  /**
   * 根据输入内容路由到最佳模型
   */
  route(messages: Array<{ role: string; content: any }>): string {
    const userInput =
      typeof messages[messages.length - 1].content === "string"
        ? messages[messages.length - 1].content
        : "";

    for (const rule of this.rules) {
      if (rule.hasImage) {
        // 检查是否包含图片
        const hasImageContent = messages.some(msg => {
          const content = msg.content;
          if (Array.isArray(content)) {
            return content.some(
              (c: any) => typeof c === "object" && c.type === "image_url"
            );
          }
          return false;
        });
        if (hasImageContent) return rule.model;
      } else if (rule.pattern && rule.pattern.test(userInput)) {
        return rule.model;
      }
    }

    return this.defaultModel;  // 默认用最好的
  }
}

// 使用示例
const router = new ModelRouter();
const model = router.route(messages);
const response = await callLLM(model, messages);
```

#### 5.5 人在回路模式（Human-in-the-Loop）

```typescript
// 关键操作需要人类审批
// 适合: 发送邮件、修改数据库、支付操作、发布内容

/**
 * 带人类审批的 Agent
 */
class HumanInTheLoopAgent {
  private static readonly DANGEROUS_ACTIONS: string[] = [
    "send_email", "delete_record", "make_payment",
    "publish_content", "modify_config",
  ];

  /**
   * 执行操作，危险操作需要审批
   */
  async executeWithApproval(action: string, params: Record<string, any>): Promise<Record<string, any>> {
    if (HumanInTheLoopAgent.DANGEROUS_ACTIONS.includes(action)) {
      // 生成审批请求
      const approvalRequest = {
        action,
        params,
        reason: await this.explainWhy(action, params),
        riskLevel: this.assessRisk(action, params),
      };

      // 发送审批（Slack/钉钉/飞书/内部系统）
      const approved = await this.requestApproval(approvalRequest);

      if (!approved) {
        return {
          status: "rejected",
          message: `操作 '${action}' 被人类审批者拒绝`,
        };
      }
    }

    // 执行操作
    return this.execute(action, params);
  }

  /**
   * 向人类解释为什么 Agent 想执行这个操作
   */
  private async explainWhy(action: string, params: Record<string, any>): Promise<string> {
    return await llm.ask(`用一句话向人类解释，为什么要执行以下操作：
操作: ${action}
参数: ${JSON.stringify(params)}
解释为什么需要这个操作：`);
  }

  /**
   * 评估操作风险等级
   */
  private assessRisk(action: string, params: Record<string, any>): string {
    if (action === "make_payment") {
      return (params.amount ?? 0) > 100 ? "high" : "medium";
    }
    if (action === "delete_record") {
      return "high";
    }
    return "medium";
  }

  /**
   * 发送审批请求到审批系统
   */
  private async requestApproval(request: Record<string, any>): Promise<boolean> {
    // 实际项目中对接 Slack/钉钉/飞书审批 API
    const response = await fetch(process.env.APPROVAL_SERVICE_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const result = await response.json();
    return result.approved ?? false;
  }

  /**
   * 实际执行操作
   */
  private async execute(action: string, params: Record<string, any>): Promise<Record<string, any>> {
    // 根据 action 类型调用不同的执行器
    console.log(`执行操作: ${action}, 参数:`, params);
    return { status: "success", action, params };
  }
}
```

### 6. AI 应用的设计原则

| 原则 | 说明 |
|------|------|
| **渐进增强** | 先做最简单的（一问一答）→ 加 RAG → 加 Agent，不要一上来就搞复杂架构 |
| **模型无关** | 不要绑死一个模型，通过 LiteLLM/OpenRouter 做抽象层 |
| **缓存优先** | 能缓存的都缓存，从 API 层到业务层 |
| **可观测** | 每条对话都要记录：用了多少 token、花了多少钱、用户满意吗 |
| **兜底机制** | 模型挂了有降级方案，Agent 卡住有超时退出 |
| **数据闭环** | 用户反馈 → 改进数据 → 优化效果，形成飞轮 |
| **安全第一** | 最小权限、输入过滤、输出审查、人类审批敏感操作 |

## 7. 推荐文章

### 数据工程
- [Unstructured.io](https://github.com/Unstructured-IO/unstructured) — 文档解析神器
- [LlamaParse](https://docs.llamaindex.ai/en/stable/llama_cloud/llama_parse/) — 高质量 PDF 解析
- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) — 中文 OCR 最佳
- [Datawhale LLM 数据教程](https://github.com/datawhalechina/llm-cookbook)

### 应用架构
- [LangGraph 文档](https://langchain-ai.github.io/langgraph/) — Agent 编排
- [LiteLLM GitHub](https://github.com/BerriAI/litellm) — 多模型网关
- [Building LLM Apps (Chip Huyen)](https://huyenchip.com/2024/02/28/genai-apps.html) — 必读
- [Patterns for Building LLM-based Systems](https://eugeneyan.com/writing/llm-patterns/) — Eugene Yan 的架构总结
