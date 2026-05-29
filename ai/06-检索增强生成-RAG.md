# RAG（检索增强生成）详解

## 1. 什么是 RAG

RAG（Retrieval-Augmented Generation，检索增强生成）是一种将**信息检索**与**文本生成**结合的 AI 架构。它让 LLM 在回答问题前，先从外部知识库中检索相关信息，再基于检索结果生成答案。

**核心思想**: LLM 不依赖自身记忆，而是"翻书"回答问题。

```
传统 LLM：问题 → [模型自身知识] → 答案（可能过时/幻觉）
RAG：    问题 → [检索文档] → [模型基于文档回答] → 答案（可追溯/更新）
```

## 2. RAG 完整流程

```
┌─────────────────────────────────────────────────────────────┐
│                    离线阶段（建库）                           │
│  文档 → 文本提取 → 文本切分(Chunking) → Embedding → 向量库   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    在线阶段（查询）                           │
│  用户问题 → Embedding → 向量检索 → 重排序 → 拼接Prompt → LLM │
└─────────────────────────────────────────────────────────────┘
```

## 3. 文档处理（Ingestion Pipeline）

### 3.1 文档解析

```typescript
// 支持多种文档格式
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";        // PDF
import { TextLoader } from "langchain/document_loaders/fs/text";                 // 纯文本 / Markdown
import { CSVLoader } from "@langchain/community/document_loaders/fs/csv";        // CSV
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";      // Word
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";  // HTML

// 加载文档
const loader = new PDFLoader("document.pdf");
const documents = await loader.load();
```

### 3.2 文本切分（Chunking）— 最关键的一步

Chunking 策略直接影响检索质量：

| 策略 | 说明 | 适用场景 |
|------|------|----------|
| 固定长度 | 按字符数/token 数切分 | 通用场景 |
| 递归分割 | 按分隔符优先级递归切分 | 代码、结构化文本 |
| 语义分割 | 用 Embedding 相似度找断点 | 长文本、文章 |
| 句子分割 | 按句子边界切分 | 翻译、问答 |
| 文档结构分割 | 按标题/章节切分 | 技术文档 |

```typescript
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

// 推荐：递归字符分割器
const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 512,       // 每块最大字符数（建议 256-1024）
  chunkOverlap: 64,     // 块之间重叠字符数（建议 chunk_size 的 10-20%）
  separators: ["\n\n", "\n", "。", ".", " ", ""],  // 分割优先级
});

const chunks = await textSplitter.splitDocuments(documents);
```

**Chunking 最佳实践**:
- **chunk_size**: 中文建议 300-800 字符，英文 500-1000 tokens
- **chunk_overlap**: 建议为 chunk_size 的 10-20%，保持语义连贯
- **语义完整性**: 尽量保持句子/段落的完整，不要在句子中间切断
- **元数据保留**: 保留文档标题、页码、章节等元数据

### 3.3 Embedding（向量化）

```typescript
import { OpenAIEmbeddings } from "@langchain/openai";

// 初始化 Embedding 模型
const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-small",  // 性价比高
  // model: "text-embedding-3-large",  // 精度更高
});

// 批量生成向量
const texts = chunks.map(chunk => chunk.pageContent);
const vectors = await embeddings.embedDocuments(texts);
```

**Embedding 模型选型**:

| 模型 | 维度 | 中文支持 | 价格 | 适用场景 |
|------|------|----------|------|----------|
| OpenAI text-embedding-3-small | 512/1536 | 好 | $0.02/1M tokens | 通用 |
| OpenAI text-embedding-3-large | 256-3072 | 好 | $0.13/1M tokens | 高精度 |
| BGE-M3 (BAAI) | 1024 | 优秀 | 免费（本地） | 中文场景首选 |
| text2vec-large-chinese | 1024 | 优秀 | 免费（本地） | 中文专用 |
| M3E (moka-ai) | 768 | 优秀 | 免费（本地） | 中文轻量 |
| Cohere Embed v3 | 1024 | 好 | 有免费额度 | 多语言 |
| Jina Embeddings v3 | 1024 | 优秀 | 有免费额度 | 长文本(8192 tokens) |

### 3.4 向量数据库

```typescript
// === Chroma - 轻量入门 ===
import { ChromaClient } from "chromadb";
const chromaClient = new ChromaClient();
const collection = await chromaClient.createCollection({ name: "my_knowledge" });
await collection.add({ ids: ids, embeddings: vectors, documents: texts });

// === Milvus - 生产级 ===
import { MilvusClient } from "@zilliz/milvus2-sdk-node";
const milvusClient = new MilvusClient({ address: "localhost:19530" });
await milvusClient.createCollection({
  collection_name: "my_knowledge",
  fields: [
    { name: "id", data_type: "Int64", is_primary_key: true, autoID: true },
    { name: "vector", data_type: "FloatVector", dim: 1536 },
    { name: "text", data_type: "VarChar", max_length: 65535 },
  ],
});
await milvusClient.insert({ collection_name: "my_knowledge", data: data });

// === FAISS - Meta 出品，高性能 ===
import { IndexFlatL2 } from "faiss-node";
const dimension = 1536;
const index = new IndexFlatL2(dimension);  // L2 距离
// 将向量转换为 Float32Array 后添加
const flatVectors = new Float32Array(vectors.flat());
index.add(flatVectors);
// 搜索: const result = index.search(queryVector, k);
// result.labels / result.distances
```

**向量数据库对比**:

| 数据库 | 部署方式 | 适用规模 | 特点 |
|--------|----------|----------|------|
| [Chroma](https://github.com/chroma-core/chroma) | 嵌入式/Server | 小-中 | 最简单，适合原型 |
| [FAISS](https://github.com/facebookresearch/faiss) | 嵌入式 | 中-大 | Meta 出品，极高性能 |
| [Milvus](https://github.com/milvus-io/milvus) | Server/Cloud | 大-超大 | 生产级，分布式 |
| [Qdrant](https://github.com/qdrant/qdrant) | Server/Cloud | 中-大 | Rust 实现，性能好 |
| [Weaviate](https://github.com/weaviate/weaviate) | Server/Cloud | 中-大 | 自带向量+对象存储 |
| [Pinecone](https://www.pinecone.io/) | Cloud | 大 | 全托管，免运维 |
| [Elasticsearch](https://github.com/elastic/elasticsearch) | Server/Cloud | 大 | 传统搜索引擎+向量 |

## 4. 检索策略

### 4.1 基础检索

```typescript
// 向量相似度检索
const results = await vectorStore.similaritySearch(query, 5);  // 返回 Top 5

// 带分数的检索
const results = await vectorStore.similaritySearchWithScore(query, 5);
// 每个结果: [Document, score]
```

### 4.2 混合检索（Hybrid Search）

结合**关键词检索（BM25）**和**向量检索**的优势：

```typescript
// 关键词匹配 + 语义匹配
// 简单的 BM25 实现（关键词检索）
class BM25 {
  private corpus: string[][];
  private docCount: number;
  private avgDocLen: number;
  private docFreq: Map<string, number>;
  private k1: number;
  private b: number;

  constructor(corpus: string[][], k1 = 1.5, b = 0.75) {
    this.corpus = corpus;
    this.docCount = corpus.length;
    this.avgDocLen = corpus.reduce((sum, doc) => sum + doc.length, 0) / this.docCount;
    this.k1 = k1;
    this.b = b;
    this.docFreq = new Map();
    // 构建文档频率索引
    for (const doc of corpus) {
      const uniqueTerms = new Set(doc);
      for (const term of uniqueTerms) {
        this.docFreq.set(term, (this.docFreq.get(term) || 0) + 1);
      }
    }
  }

  // 计算 IDF
  private getIdf(term: string): number {
    const df = this.docFreq.get(term) || 0;
    if (df === 0) return 0;
    return Math.log((this.docCount - df + 0.5) / (df + 0.5) + 1);
  }

  // 获取 Top N 结果的索引
  getTopNIndices(query: string[], n: number): number[] {
    const scores = this.corpus.map((doc, idx) => {
      const docLen = doc.length;
      let score = 0;
      for (const term of query) {
        const tf = doc.filter(t => t === term).length;
        if (tf === 0) continue;
        const idf = this.getIdf(term);
        score += (idf * tf * (this.k1 + 1)) /
          (tf + this.k1 * (1 - this.b + this.b * docLen / this.avgDocLen));
      }
      return { idx, score };
    });
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, n).map(s => s.idx);
  }
}

// BM25 关键词检索
const tokenizedCorpus = documents.map(doc => doc.split(/\s+/));
const bm25 = new BM25(tokenizedCorpus);
const bm25Indices = bm25.getTopNIndices(query.split(/\s+/), 10);
// 构造与向量检索结果结构一致的文档对象
const bm25Results = bm25Indices.map(idx => ({
  metadata: { id: `doc_${idx}` },
  pageContent: documents[idx],
}));

// 向量语义检索
const vectorResults = await vectorStore.similaritySearch(query, 10);

// 融合（RRF - Reciprocal Rank Fusion）
function reciprocalRankFusion(resultsList: Document[][], k = 60): [string, number][] {
  /** 融合多种检索结果 */
  const scores: Record<string, number> = {};
  for (const results of resultsList) {
    results.forEach((doc, rank) => {
      const docId = doc.metadata.id;
      scores[docId] = (scores[docId] || 0) + 1 / (k + rank + 1);
    });
  }
  return Object.entries(scores).sort((a, b) => b[1] - a[1]);
}

const finalResults = reciprocalRankFusion([bm25Results, vectorResults]);
```

### 4.3 重排序（Re-ranking）

检索后再用更强的模型重新排序：

```typescript
// 使用 Cross-encoder 重排序
// 方案A: 使用 @xenova/transformers（本地运行）
import { pipeline } from "@xenova/transformers";

// 两阶段检索
// Stage 1: 快速召回（用 Embedding 检索 Top 20-50）
const candidates = await vectorStore.similaritySearch(query, 20);

// Stage 2: 精排（用 Cross-encoder 对候选重新打分排序）
const reranker = await pipeline("text-classification", "Xenova/bge-reranker-base");
const pairs = candidates.map(doc => `${query} [SEP] ${doc.pageContent}`);
const scores = await Promise.all(pairs.map(pair => reranker(pair)));
const ranked = candidates
  .map((doc, i) => ({ doc, score: scores[i].score }))
  .sort((a, b) => b.score - a.score);

// 取 Top 5 给 LLM
const topDocs = ranked.slice(0, 5).map(r => r.doc);

// 方案B: 使用 Cohere Rerank API（商业服务，生产推荐）
// import { CohereClient } from "cohere-ai";
// const cohere = new CohereClient({ token: "YOUR_API_KEY" });
// const rerankResult = await cohere.rerank({
//   query,
//   documents: candidates.map(d => d.pageContent),
//   topN: 5,
// });
```

**常用 Reranker 模型**:
- `BAAI/bge-reranker-large` — 中文最佳
- `BAAI/bge-reranker-v2-m3` — 多语言
- `Cohere Rerank` — 商业 API
- `Jina Reranker` — 多语言

### 4.4 高级检索策略

```typescript
// Multi-Query Retrieval — 用多个变体问题检索，合并结果
import { MultiQueryRetriever } from "langchain/retrievers/multi_query";

// 生成多个查询变体
const response = await llm.invoke(`为以下问题生成3个不同表述：${originalQuery}`);
// 将生成结果按行拆分为多个查询
const queries = response.content.toString().split("\n").filter(q => q.trim());
const results = [];
for (const q of queries) {
  const searchResults = await vectorStore.similaritySearch(q, 5);
  results.push(...searchResults);
}
// 去重（按文档 ID 去重）
const seen = new Set<string>();
const merged = results.filter(doc => {
  const id = doc.metadata.id;
  if (seen.has(id)) return false;
  seen.add(id);
  return true;
});

// Parent Document Retriever — 检索小块，返回大块
// 索引时切成小块(如256)，检索时返回父文档(如1024)
import { ParentDocumentRetriever } from "langchain/retrievers/parent_document";
```

## 5. Prompt 构造

```typescript
function buildRagPrompt(query: string, retrievedDocs: Array<{
  pageContent: string;
  metadata: Record<string, any>;
}>, maxTokens = 3000): string {
  /** 构建 RAG 的最终 Prompt */
  // 格式化检索到的文档
  const contextParts = retrievedDocs.map((doc, i) => {
    const source = doc.metadata?.source || "未知来源";
    return `[文档${i + 1} | 来源: ${source}]\n${doc.pageContent}`;
  });

  const context = contextParts.join("\n\n---\n\n");

  // 构建完整 Prompt
  const prompt = `你是一个专业的AI助手。请基于以下参考资料回答用户问题。

## 规则
- 只使用参考资料中的信息回答问题
- 如果参考资料不足以回答问题，请明确说明"根据现有资料无法完全回答"
- 引用时注明出自哪个文档
- 不要编造参考资料中没有的信息

## 参考资料
${context}

## 用户问题
${query}

## 回答
请基于上述资料回答问题：`;

  return prompt;
}
```

## 6. RAG 评估

### 6.1 评估维度

| 维度 | 说明 | 评估方法 |
|------|------|----------|
| 检索准确性 | 检索到的文档是否相关 | Recall@k, Precision@k, MRR |
| 答案忠实度 | 答案是否忠于检索到的文档 | RAGAS Faithfulness |
| 答案相关性 | 答案是否回答了问题 | RAGAS Answer Relevancy |
| 上下文精确度 | 检索到的文档中相关比例 | RAGAS Context Precision |
| 上下文召回率 | 相关文档被检索到的比例 | RAGAS Context Recall |

### 6.2 使用 RAGAS 评估

```typescript
// RAGAS 是 Python 专属的评估框架，Node.js/TypeScript 用户有以下选择：
//   方案1: 通过子进程调用 Python RAGAS 脚本（推荐）
//   方案2: 将 RAGAS 封装为 HTTP API 微服务
//   方案3: 使用其他语言无关的评估指标手动计算

// 以下展示如何通过 Node.js 调用 Python RAGAS 脚本
import { execSync } from "child_process";
import * as fs from "fs";

// 准备评估数据（纯 JS 对象数组）
const evalData = {
  question: ["什么是MCP协议？"],
  answer: ["MCP是Model Context Protocol的缩写..."],
  contexts: [["MCP是一种开放协议..."]],
  ground_truth: ["MCP是Anthropic推出的模型上下文协议"],
};

// 方式一: 将数据写入 JSON 文件，调用 Python 脚本
fs.writeFileSync("eval_input.json", JSON.stringify(evalData, null, 2));
try {
  const result = execSync("python evaluate_ragas.py eval_input.json", {
    encoding: "utf-8",
  });
  console.log(result);
} catch (err) {
  console.error("RAGAS 评估失败:", err);
}

// 方式二: 手动实现简化版评估指标
function simpleFaithfulnessCheck(answer: string, contexts: string[]): number {
  /** 简化的忠实度检查：答案中的关键声明是否能在上下文中找到 */
  const sentences = answer.split(/[。！？]/).filter(s => s.trim().length > 5);
  if (sentences.length === 0) return 0;
  const supported = sentences.filter(sentence =>
    contexts.some(ctx => ctx.includes(sentence.trim().substring(0, 10)))
  );
  return supported.length / sentences.length;
}

const faithfulnessScore = simpleFaithfulnessCheck(
  evalData.answer[0],
  evalData.contexts[0]
);
console.log(`忠实度分数: ${faithfulnessScore}`);

// 生产环境建议: 搭建 Python RAGAS 微服务，通过 HTTP API 调用
// 参考: https://github.com/explodinggradients/ragas
```

## 7. RAG 进阶架构

### 7.1 Self-RAG

让模型在生成过程中**自主决定何时需要检索**：

```
对于每个生成步骤：
1. 判断：需要检索外部信息吗？
2. 如果需要 → 检索 → 判断检索结果是否相关
3. 如果相关 → 基于检索结果生成
4. 如果不相关/不需要 → 基于自身知识生成
5. 自我反思：生成的结果是否被检索内容支持？
```

**论文**: [Self-RAG: Learning to Retrieve, Generate, and Critique](https://arxiv.org/abs/2310.11511)
**GitHub**: https://github.com/AkariAsai/self-rag

### 7.2 Corrective RAG (CRAG)

```
检索 → 评估检索质量 → 如果不相关 → 自动修正检索策略 → 重新检索
```

**论文**: [Corrective RAG](https://arxiv.org/abs/2401.15884)

### 7.3 Graph RAG

结合**知识图谱**的 RAG：

```
用户问题 → 实体识别 → 知识图谱查询 → 获取结构化知识 → LLM 生成
```

**GitHub**: 
- [Microsoft GraphRAG](https://github.com/microsoft/graphrag)
- [LightRAG](https://github.com/HKUDS/LightRAG)

### 7.4 Agentic RAG

用 Agent 的思路做 RAG，让 LLM 自主决定检索策略：

```
用户问题 → Agent 分析 → 分解为子问题 → 多轮检索 → 综合回答
```

## 8. RAG 各阶段最佳实践总结

| 阶段 | 最佳实践 |
|------|----------|
| 文档解析 | 保留文档结构（标题层级、表格、列表） |
| 文本切分 | chunk_size 256-1024，overlap 10-20%，保持语义完整 |
| Embedding | 中文场景优先用 BGE-M3，多语言用 OpenAI |
| 向量库 | 原型用 Chroma，生产用 Milvus/Qdrant |
| 检索 | 混合检索(BM25 + 向量) + 重排序 |
| Prompt | 明确"只能基于资料回答"，注明来源 |
| 评估 | 用 RAGAS 做离线评估 + 用户反馈做在线评估 |

## 9. 推荐文章与资源

### 必读文章
- [RAG 论文综述 (Gao et al.)](https://arxiv.org/abs/2312.10997) — RAG 全景图
- [Retrieval-Augmented Generation for LLMs (Lewis et al.)](https://arxiv.org/abs/2005.11401) — RAG 原始论文
- [Advanced RAG Techniques (LangChain Blog)](https://blog.langchain.dev/) — 进阶 RAG 技巧集
- [Improving RAG (Anthropic)](https://docs.anthropic.com/en/docs/build-with-claude/embeddings)

### GitHub 仓库
- [awesome-rag](https://github.com/awesome-rag/awesome-rag) — RAG 资源大合集
- [LangChain](https://github.com/langchain-ai/langchain) — 最流行的 RAG 框架
- [LlamaIndex](https://github.com/run-llama/llama_index) — 专注数据索引的 LLM 框架
- [RAGAS](https://github.com/explodinggradients/ragas) — RAG 评估框架
- [Dify](https://github.com/langgenius/dify) — 低代码 RAG 平台
- [FastGPT](https://github.com/labring/FastGPT) — 中文 RAG 最佳实践
- [RAGFlow](https://github.com/infiniflow/ragflow) — 深度文档理解的 RAG 引擎
- [MaxKB](https://github.com/1Panel-dev/MaxKB) — 中文知识库问答系统
- [Verba](https://github.com/weaviate/Verba) — 可视化 RAG 助手
- [GraphRAG](https://github.com/microsoft/graphrag) — 微软图 RAG
