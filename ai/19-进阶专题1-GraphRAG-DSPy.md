# 进阶专题：Graph RAG 与 DSPy

> 本文涵盖两个高阶 AI 工程主题：**Graph RAG**（知识图谱增强检索）和 **DSPy**（自动化 Prompt 优化）。
> 这两个技术分别解决了 RAG 系统中"结构化关系丢失"的问题和 Prompt 工程中"手动调参不可规模化"的问题。
> 本文重点在于帮助你**判断何时使用**这些技术，而不仅仅是"如何使用"。

---

# 第一部分：Graph RAG（知识图谱增强 RAG）

## 1. 传统 RAG 的盲区

### 1.1 问题场景

假设你有这样一段文档：

> "史蒂夫·乔布斯（Steve Jobs）是苹果公司的联合创始人。他于 1991 年与劳伦·鲍威尔（Laurene Powell）结婚。劳伦·鲍威尔是一位慈善家，毕业于宾夕法尼亚大学和斯坦福商学院。"

用户问："**乔布斯的妻子是谁？**"

**传统 RAG 的处理流程**：

```
用户问题："乔布斯的妻子是谁？"
     ↓
  Embedding → 向量相似度搜索
     ↓
找到最相似的 chunks：
  ✓ "史蒂夫·乔布斯（Steve Jobs）是苹果公司的联合创始人..."
  ✓ "他于 1991 年与劳伦·鲍威尔（Laurene Powell）结婚..."
  ✗ "劳伦·鲍威尔是一位慈善家..." ← 这一句可能漏掉！
     ↓
  问题：如果"劳伦·鲍威尔"所在的 chunk 不包含"乔布斯"这个词，
  向量相似度可能不够高，导致关键信息被遗漏
```

**核心问题**：向量检索基于语义相似度，它擅长找"意思相近"的文本，但不擅长追踪实体之间的**结构化关系**（如婚姻、雇佣、隶属等）。

### 1.2 Graph RAG 解决什么

Graph RAG 在向量检索之上叠加了一层**知识图谱**（Knowledge Graph），将文档中的实体和关系显式建模：

```
┌─────────────────────────────────────────────────────────────────┐
│                    传统 RAG（向量检索）                           │
│                                                                 │
│  Embedding索引 → 问题向量化 → Top-K 相似chunks → 喂给LLM        │
│                                                                 │
│  优势：简单、快速、适合语义模糊的开放问题                         │
│  劣势：丢失实体间的关系链，涉及多方关联的问题准确率低              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    Graph RAG（向量 + 图谱）                       │
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌──────────┐               │
│  │ 向量检索  │ +  │  图谱查询     │ =  │ 混合结果  │ → LLM        │
│  └──────────┘    └──────────────┘    └──────────┘               │
│                                                                 │
│  优势：实体关系不丢失，多跳查询准确率高                           │
│  劣势：构建图谱成本高，延迟增加                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Graph RAG 的回答流程**：

```
用户问题："乔布斯的妻子是谁？"
     ↓
  ┌─────────────────┐     ┌─────────────────────────────┐
  │ 向量检索          │     │ 图谱查询                     │
  │ 找到"乔布斯"chunks│     │ 实体"Steve Jobs" →          │
  │                  │     │  关系"配偶" →                │
  │                  │     │  实体"Laurene Powell"        │
  └────────┬─────────┘     └──────────────┬───────────────┘
           │                              │
           └──────────┬───────────────────┘
                      ↓
         合并结果 → LLM 生成准确答案
```

---

## 2. Graph RAG 完整架构

```
┌──────────────────────────────────────────────────────────────────┐
│                      离线阶段（建图）                              │
│                                                                  │
│  文档 → 实体提取(LLM) → 关系提取(LLM) → 构建图谱 → 存储(内存/DB)  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                               ↓
┌──────────────────────────────────────────────────────────────────┐
│                      在线阶段（查询）                              │
│                                                                  │
│  问题 → 实体识别 → 图谱遍历(找关联实体) → 向量检索 →              │
│  结果合并 → 重排序 → Prompt组装 → LLM生成                         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. TypeScript 完整实现

### 3.1 实体与关系提取

这是 Graph RAG 最核心的一步：用 LLM 从文本中提取实体和它们之间的关系。

```typescript
// ============================================================
// types.ts — Graph RAG 核心类型定义
// ============================================================

/** 知识图谱中的实体节点 */
interface Entity {
  id: string;           // 实体唯一标识，如 "steve_jobs"
  name: string;         // 实体名称，如 "Steve Jobs"
  type: string;         // 实体类型：PERSON / ORG / LOCATION / DATE / EVENT
  properties: Record<string, string>;  // 额外属性，如 { role: "CEO", birthYear: "1955" }
}

/** 知识图谱中的关系边 */
interface Relationship {
  source: string;       // 头实体 ID
  target: string;       // 尾实体 ID
  type: string;         // 关系类型：WORKS_FOR / MARRIED_TO / FOUNDED / LOCATED_IN
  evidence: string;     // 原文中支持该关系的证据片段（用于溯源）
  properties?: Record<string, string>;  // 额外属性，如 { since: "1991" }
}

/** LLM 提取实体和关系的原始返回结果 */
interface ExtractionResult {
  entities: Entity[];
  relationships: Relationship[];
}
```

```typescript
// ============================================================
// entity-extractor.ts — 用 LLM 从文档中提取实体和关系
// ============================================================

import OpenAI from "openai";

/**
 * 实体提取器
 * 使用 LLM 解析文本，输出结构化的实体和关系数据
 * 
 * 设计要点：
 * - JSON mode 确保输出格式可靠（不用正则解析）
 * - few-shot 示例帮助 LLM 理解提取粒度
 * - 批量处理长文档（按 chunk 处理，最后去重合并）
 */
class EntityExtractor {
  private client: OpenAI;
  private model: string;

  // Few-shot 示例：教 LLM 如何提取实体和关系
  // 这比写一堆 prompt 描述更有效
  private readonly FEW_SHOT_EXAMPLE = `
示例输入：
"Tim Cook 于 2011 年接替 Steve Jobs 成为 Apple 的 CEO。Apple 总部位于加利福尼亚州 Cupertino。"

示例输出：
{
  "entities": [
    { "id": "tim_cook", "name": "Tim Cook", "type": "PERSON", "properties": {} },
    { "id": "steve_jobs", "name": "Steve Jobs", "type": "PERSON", "properties": {} },
    { "id": "apple_inc", "name": "Apple", "type": "ORG", "properties": {} },
    { "id": "cupertino", "name": "Cupertino", "type": "LOCATION", "properties": {} }
  ],
  "relationships": [
    { "source": "tim_cook", "target": "apple_inc", "type": "WORKS_FOR", "evidence": "Tim Cook 于 2011 年接替 Steve Jobs 成为 Apple 的 CEO", "properties": { "role": "CEO" } },
    { "source": "tim_cook", "target": "steve_jobs", "type": "SUCCEEDED", "evidence": "Tim Cook 于 2011 年接替 Steve Jobs", "properties": { "year": "2011" } },
    { "source": "apple_inc", "target": "cupertino", "type": "LOCATED_IN", "evidence": "Apple 总部位于加利福尼亚州 Cupertino", "properties": {} }
  ]
}`;

  constructor(apiKey: string, model: string = "gpt-4o") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  /**
   * 从一段文本中提取实体和关系
   * 
   * @param text - 要提取的原始文本
   * @returns 结构化的实体和关系列表
   */
  async extract(text: string): Promise<ExtractionResult> {
    // System prompt 定义提取规则
    const systemPrompt = `你是一个知识图谱构建专家。请从给定的文本中提取所有的实体和关系。

## 实体提取规则
- 提取所有人物(PERSON)、组织(ORG)、地点(LOCATION)、日期(DATE)、事件(EVENT)
- 每个实体必须有唯一的 id（英文小写 + 下划线）
- 合并指代同一实体的不同表达（如"乔布斯"和"Steve Jobs"是同一个实体）

## 关系提取规则
- 关系类型：WORKS_FOR, MARRIED_TO, FOUNDED, LOCATED_IN, SUCCEEDED, ACQUIRED, PRODUCED, GRADUATED_FROM
- 每个关系必须有 evidence 字段，引用原文中的证据
- 只提取文本中明确提到的关系，不要脑补

## 输出格式
必须返回 JSON，包含 entities 数组和 relationships 数组。
${this.FEW_SHOT_EXAMPLE}`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `请从以下文本中提取实体和关系：\n\n${text}` },
      ],
      response_format: { type: "json_object" },  // JSON mode 确保输出格式
      temperature: 0.1,  // 低温度保证一致性
    });

    const result = JSON.parse(response.choices[0].message.content || "{}");

    // 验证提取结果的完整性
    return {
      entities: result.entities || [],
      relationships: result.relationships || [],
    };
  }

  /**
   * 批量处理长文档：先分块，再逐块提取，最后去重合并
   * 
   * @param document - 完整文档内容
   * @param chunkSize - 每块大概处理的字符数
   */
  async extractFromDocument(
    document: string,
    chunkSize: number = 2000
  ): Promise<ExtractionResult> {
    // 简单按段落分块（生产环境建议用更智能的分割器）
    const paragraphs = document.split(/\n\n+/);
    const chunks: string[] = [];
    let currentChunk = "";

    for (const p of paragraphs) {
      if (currentChunk.length + p.length > chunkSize && currentChunk) {
        chunks.push(currentChunk);
        currentChunk = p;
      } else {
        currentChunk += (currentChunk ? "\n\n" : "") + p;
      }
    }
    if (currentChunk) chunks.push(currentChunk);

    // 对每个 chunk 并发提取（控制并发数为 3 避免触发限流）
    const allResults = await this.batchWithConcurrency(
      chunks,
      (chunk) => this.extract(chunk),
      3
    );

    // 去重合并：以 entity.id 去重，以 (source, target, type) 去重关系
    return this.mergeAndDeduplicate(allResults);
  }

  /**
   * 合并多个提取结果，去除重复的实体和关系
   */
  private mergeAndDeduplicate(results: ExtractionResult[]): ExtractionResult {
    const entityMap = new Map<string, Entity>();
    const relationshipSet = new Set<string>();

    for (const result of results) {
      for (const entity of result.entities) {
        // 同一 ID 只保留第一个（或者选择 properties 更丰富的那个）
        if (!entityMap.has(entity.id)) {
          entityMap.set(entity.id, entity);
        }
      }
      for (const rel of result.relationships) {
        // 用三元组作为唯一性判定
        const key = `${rel.source}|${rel.target}|${rel.type}`;
        relationshipSet.add(key);
      }
    }

    // 还原关系对象
    const allRelationships: Relationship[] = [];
    for (const result of results) {
      for (const rel of result.relationships) {
        const key = `${rel.source}|${rel.target}|${rel.type}`;
        if (relationshipSet.has(key)) {
          allRelationships.push(rel);
          relationshipSet.delete(key);  // 避免重复添加
        }
      }
    }

    return {
      entities: Array.from(entityMap.values()),
      relationships: allRelationships,
    };
  }

  /**
   * 控制并发数量的批量处理
   */
  private async batchWithConcurrency<T, U>(
    items: T[],
    fn: (item: T) => Promise<U>,
    concurrency: number
  ): Promise<U[]> {
    const results: U[] = [];
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch.map(fn));
      results.push(...batchResults);
    }
    return results;
  }
}
```

### 3.2 内存知识图谱类

生产环境建议用 Neo4j，但这里实现一个轻量的内存版本便于理解原理。

```typescript
// ============================================================
// knowledge-graph.ts — 内存知识图谱的实现
// ============================================================

/**
 * 简单的内存知识图谱
 * 
 * 核心数据结构：
 * - 邻接表（Adjacency List）：每个节点指向它的邻居
 * - 双向索引：可以通过 ID 或名称查找实体
 * 
 * 设计权衡：
 * - 优势：零依赖，适合中小规模数据（< 100K 节点）
 * - 劣势：无持久化，无事务，大规模时查询性能比 Neo4j 差
 */
class KnowledgeGraph {
  // 核心存储：邻接表 + 节点数据
  private nodes: Map<string, Entity> = new Map();             // id → Entity
  private nameIndex: Map<string, string[]> = new Map();       // name → [id1, id2, ...]（支持重名）
  private adjacency: Map<string, Relationship[]> = new Map();  // entityId → 该节点的所有边
  private relationshipMap: Map<string, Relationship> = new Map(); // relKey → Relationship

  /**
   * 从提取结果构建知识图谱
   */
  buildFromExtraction(extraction: ExtractionResult): void {
    // 1. 添加所有实体节点
    for (const entity of extraction.entities) {
      this.addNode(entity);
    }

    // 2. 添加所有关系边
    for (const rel of extraction.relationships) {
      this.addRelationship(rel);
    }

    console.log(
      `[Graph] 已加载 ${this.nodes.size} 个实体, ` +
      `${this.relationshipMap.size} 条关系`
    );
  }

  /**
   * 添加一个实体节点
   */
  addNode(entity: Entity): void {
    this.nodes.set(entity.id, entity);

    // 同时更新名称索引（支持一个名称对应多个实体的情况）
    const lowerName = entity.name.toLowerCase();
    if (!this.nameIndex.has(lowerName)) {
      this.nameIndex.set(lowerName, []);
    }
    this.nameIndex.get(lowerName)!.push(entity.id);
  }

  /**
   * 添加一条关系边
   */
  addRelationship(rel: Relationship): void {
    const key = `${rel.source}|${rel.target}|${rel.type}`;
    this.relationshipMap.set(key, rel);

    // 更新源节点的邻接表
    if (!this.adjacency.has(rel.source)) {
      this.adjacency.set(rel.source, []);
    }
    this.adjacency.get(rel.source)!.push(rel);

    // 双向图：反向边也加入（便于反向遍历）
    if (!this.adjacency.has(rel.target)) {
      this.adjacency.set(rel.target, []);
    }
    this.adjacency.get(rel.target)!.push(rel);
  }

  /**
   * 通过名称模糊查找实体（支持中英文、部分匹配）
   * 这是图谱查询的入口：从问题中识别出实体名 → 找到图谱中的节点
   */
  findEntities(query: string): Entity[] {
    const lowerQuery = query.toLowerCase();
    const results: Entity[] = [];

    // 策略1：精确匹配
    for (const [name, ids] of this.nameIndex.entries()) {
      if (name === lowerQuery) {
        for (const id of ids) {
          results.push(this.nodes.get(id)!);
        }
      }
    }

    // 策略2：模糊匹配（包含关系）
    if (results.length === 0) {
      for (const [name, ids] of this.nameIndex.entries()) {
        if (name.includes(lowerQuery) || lowerQuery.includes(name)) {
          for (const id of ids) {
            results.push(this.nodes.get(id)!);
          }
        }
      }
    }

    return results;
  }

  /**
   * 获取某个实体的所有直接邻居（1 跳）
   * 
   * 返回格式：{ entity: 邻居实体, relationship: 关系详情, direction: "out" | "in" }
   */
  getNeighbors(entityId: string): Array<{
    entity: Entity;
    relationship: Relationship;
    direction: "out" | "in";
  }> {
    const edges = this.adjacency.get(entityId) || [];
    const neighbors: Array<{
      entity: Entity;
      relationship: Relationship;
      direction: "out" | "in";
    }> = [];

    for (const rel of edges) {
      if (rel.source === entityId) {
        // 当前节点是关系的起点，邻居是 target
        const neighbor = this.nodes.get(rel.target);
        if (neighbor) {
          neighbors.push({ entity: neighbor, relationship: rel, direction: "out" });
        }
      }
      if (rel.target === entityId) {
        // 当前节点是关系的终点，邻居是 source
        const neighbor = this.nodes.get(rel.source);
        if (neighbor) {
          neighbors.push({ entity: neighbor, relationship: rel, direction: "in" });
        }
      }
    }

    return neighbors;
  }

  /**
   * 广度优先遍历（BFS）获取 N 跳内的所有实体和路径
   * 
   * 这是图谱检索的核心：从问题中识别的实体出发，找到所有关联的实体。
   * 
   * @param entityId - 起点实体 ID
   * @param maxHops - 最大跳数（建议 2-3，太多会引入噪声）
   * @returns 到达的实体和它们的最短路径
   */
  breadthFirstSearch(
    entityId: string,
    maxHops: number = 2
  ): Map<string, { entity: Entity; path: string[]; distance: number }> {
    const visited = new Map<string, { entity: Entity; path: string[]; distance: number }>();
    const queue: Array<{ id: string; path: string[]; distance: number }> = [
      { id: entityId, path: [entityId], distance: 0 },
    ];

    // 起点自身也算（距离为 0）
    const startNode = this.nodes.get(entityId);
    if (startNode) {
      visited.set(entityId, { entity: startNode, path: [entityId], distance: 0 });
    }

    while (queue.length > 0) {
      const current = queue.shift()!;

      // 达到最大跳数就不再继续探索
      if (current.distance >= maxHops) continue;

      const neighbors = this.getNeighbors(current.id);
      for (const { entity: neighbor, relationship } of neighbors) {
        // 已访问过的节点跳过（BFS 保证第一次访问就是最短路径）
        if (visited.has(neighbor.id)) continue;

        const newPath = [...current.path, `--[${relationship.type}]-->`, neighbor.id];
        visited.set(neighbor.id, {
          entity: neighbor,
          path: newPath,
          distance: current.distance + 1,
        });

        queue.push({ id: neighbor.id, path: newPath, distance: current.distance + 1 });
      }
    }

    return visited;
  }

  /**
   * 将 BFS 的路径信息转换为可读的文本描述
   * 这些文本将作为 Graph RAG 的上下文拼接进 LLM Prompt
   */
  formatSubgraph(entityId: string, maxHops: number = 2): string {
    const results = this.breadthFirstSearch(entityId, maxHops);
    if (results.size === 0) return "";

    const lines: string[] = [];
    lines.push(`## 知识图谱子图（实体："${this.nodes.get(entityId)?.name}" 的 ${maxHops} 跳邻居）`);

    for (const [id, { entity, path, distance }] of results.entries()) {
      if (distance === 0) continue;  // 跳过一次起点实体本身

      // 找到与这个实体直接相关的边
      const edges = this.getEdgeSummary(entity.id);
      lines.push(
        `- **${entity.name}** (${entity.type})` +
        ` ← [距离 ${distance} 跳, 通过 ${this.getEdgeSummary(entity.id).join(", ")}]`
      );
    }

    // 同时也输出所有相关的关系证据文本
    const evidenceTexts = this.collectEvidence(entityId, maxHops);
    if (evidenceTexts.length > 0) {
      lines.push("\n### 关系证据（原文摘要）");
      for (const ev of evidenceTexts) {
        lines.push(`- ${ev}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * 获取一个实体的所有边的摘要（关系类型 + 对端实体名）
   */
  private getEdgeSummary(entityId: string): string[] {
    const edges = this.adjacency.get(entityId) || [];
    const summaries: string[] = [];

    for (const rel of edges) {
      const otherId = rel.source === entityId ? rel.target : rel.source;
      const otherNode = this.nodes.get(otherId);
      const otherName = otherNode?.name || otherId;
      const direction = rel.source === entityId ? "→" : "←";
      summaries.push(`${direction} ${rel.type} ${otherName}`);
    }

    return summaries;
  }

  /**
   * 收集子图范围内的所有关系证据（原文）
   */
  private collectEvidence(entityId: string, maxHops: number): string[] {
    const results = this.breadthFirstSearch(entityId, maxHops);
    const seenEvidence = new Set<string>();
    const evidenceTexts: string[] = [];

    for (const [id] of results.entries()) {
      const edges = this.adjacency.get(id) || [];
      for (const rel of edges) {
        if (!seenEvidence.has(rel.evidence)) {
          seenEvidence.add(rel.evidence);
          evidenceTexts.push(rel.evidence);
        }
      }
    }

    return evidenceTexts;
  }

  /**
   * 导出图的统计信息（用于调试和监控）
   */
  getStats(): { nodeCount: number; edgeCount: number; avgDegree: number } {
    const nodeCount = this.nodes.size;
    const edgeCount = this.relationshipMap.size;
    const totalEdges = Array.from(this.adjacency.values()).reduce((sum, e) => sum + e.length, 0);
    const avgDegree = nodeCount > 0 ? totalEdges / nodeCount : 0;

    return { nodeCount, edgeCount, avgDegree };
  }
}
```

### 3.3 混合检索器（图谱 + 向量）

这是 Graph RAG 的核心引擎：同时从两个"数据源"检索，然后合并结果。

```typescript
// ============================================================
// hybrid-retriever.ts — 混合检索器：图谱检索 + 向量检索
// ============================================================

import OpenAI from "openai";

/** 单条检索结果 */
interface RetrievalItem {
  content: string;      // 文本内容
  source: "vector" | "graph";  // 来源标记（方便调试和权重调整）
  score: number;        // 相关性分数（0-1，不同来源的分数已做归一化）
  metadata?: Record<string, unknown>;  // 额外元数据
}

/** 向量检索器的抽象接口 */
interface VectorStore {
  search(query: string, topK: number): Promise<RetrievalItem[]>;
}

/**
 * 混合检索器
 * 
 * 核心流程：
 * 1. 从用户问题中提取实体名称
 * 2. 在图谱中查找这些实体，进行 BFS 获取关联实体
 * 3. 同时进行向量检索获取语义相似的 chunks
 * 4. 合并去重 → 给 LLM 生成答案
 * 
 * 为什么要混合？
 * - 图谱擅长结构化关系（"A 和 B 什么关系？"）
 * - 向量擅长语义宽泛的问题（"如何提高团队效率？"）
 * - 两者互补，覆盖更多查询类型
 */
class HybridRetriever {
  private graph: KnowledgeGraph;
  private vectorStore: VectorStore;
  private llmClient: OpenAI;
  private model: string;

  // 配置参数
  private config = {
    graphTopK: 10,       // 图谱检索返回的关联实体数上限
    vectorTopK: 5,       // 向量检索返回的 chunk 数上限
    maxGraphHops: 2,     // 图遍历的最大跳数
    graphScoreWeight: 0.5,  // 图谱结果的分数权重（向量结果权重 = 1 - 此值）
  };

  constructor(
    graph: KnowledgeGraph,
    vectorStore: VectorStore,
    llmApiKey: string,
    model: string = "gpt-4o"
  ) {
    this.graph = graph;
    this.vectorStore = vectorStore;
    this.llmClient = new OpenAI({ apiKey: llmApiKey });
    this.model = model;
  }

  /**
   * 从用户问题中提取实体名称（用 LLM 做实体识别）
   * 
   * 这是混合检索的关键步：如果无法从问题中识别出实体，
   * 图谱检索将无法发挥作用，只能退化到纯向量检索。
   */
  async extractQueryEntities(question: string): Promise<string[]> {
    const prompt = `从以下问题中提取所有提到的实体名称（人名、组织名、地名、产品名等）。
只返回 JSON 数组，不要包含其他内容。如果没有明显的实体，返回空数组。

问题：${question}

示例：
"乔布斯的妻子是谁？" → ["乔布斯"]
"微软和 OpenAI 是什么关系？" → ["微软", "OpenAI"]
"如何提高代码质量？" → []`;

    const response = await this.llmClient.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0,
    });

    const result = JSON.parse(response.choices[0].message.content || "{}");
    return result.entities || [];
  }

  /**
   * 执行混合检索
   * 
   * @param question - 用户问题
   * @returns 排序后的检索结果列表
   */
  async retrieve(question: string): Promise<RetrievalItem[]> {
    // Step 1: 从问题中提取实体
    const entityNames = await this.extractQueryEntities(question);

    // Step 2: 并行执行图谱检索和向量检索
    const [graphResults, vectorResults] = await Promise.all([
      this.graphSearch(entityNames),
      this.vectorStore.search(question, this.config.vectorTopK),
    ]);

    console.log(
      `[HybridRetriever] 图谱结果: ${graphResults.length}, ` +
      `向量结果: ${vectorResults.length}`
    );

    // Step 3: 合并结果并去重
    const merged = this.mergeAndDeduplicate(graphResults, vectorResults);

    // Step 4: 重排序（按分数降序）
    merged.sort((a, b) => b.score - a.score);

    return merged;
  }

  /**
   * 图谱检索：从实体名称出发，在图谱中查找关联信息
   */
  private async graphSearch(entityNames: string[]): Promise<RetrievalItem[]> {
    if (entityNames.length === 0) return [];

    const items: RetrievalItem[] = [];
    const seenEntityIds = new Set<string>();

    for (const name of entityNames) {
      // 在图谱中查找实体
      const entities = this.graph.findEntities(name);

      for (const entity of entities) {
        // 获取该实体的 N 跳子图
        const bfsResults = this.graph.breadthFirstSearch(
          entity.id,
          this.config.maxGraphHops
        );

        for (const [id, { entity: e, distance }] of bfsResults.entries()) {
          if (seenEntityIds.has(id) || distance === 0) continue;
          seenEntityIds.add(id);

          // 构建信息片段：实体名称 + 类型 + 与起点的关系距离
          const content = `[实体] ${e.name} (类型: ${e.type}, 距"${entity.name}" ${distance} 跳)`;

          // 分数计算：距离越近分数越高
          const score = 1.0 / (1 + distance) * this.config.graphScoreWeight;

          items.push({
            content,
            source: "graph",
            score,
            metadata: {
              entityId: e.id,
              entityType: e.type,
              distance,
              startEntity: entity.name,
            },
          });
        }
      }
    }

    // 截取 Top-K
    items.sort((a, b) => b.score - a.score);
    return items.slice(0, this.config.graphTopK);
  }

  /**
   * 合并两个来源的结果并去重
   * 
   * 去重策略：基于文本内容的 Jaccard 相似度判断重复
   * 当两个结果高度重叠时，保留分数更高的那个
   */
  private mergeAndDeduplicate(
    graphItems: RetrievalItem[],
    vectorItems: RetrievalItem[]
  ): RetrievalItem[] {
    const allItems = [...graphItems, ...vectorItems];
    const deduplicated: RetrievalItem[] = [];

    for (const item of allItems) {
      // 检查是否与已有结果重复
      const isDuplicate = deduplicated.some((existing) => {
        return this.jaccardSimilarity(item.content, existing.content) > 0.7;
      });

      if (!isDuplicate) {
        deduplicated.push(item);
      }
    }

    return deduplicated;
  }

  /**
   * 计算两个字符串的 Jaccard 相似度（基于词级）
   * 用于去重判断：如果两个检索片段几乎相同，只保留一个
   */
  private jaccardSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));

    const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);

    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /**
   * 获取图的结构化文本描述（用于拼接 Prompt）
   */
  getGraphContext(entityNames: string[]): string {
    if (entityNames.length === 0) return "";

    const parts: string[] = [];
    for (const name of entityNames) {
      const entities = this.graph.findEntities(name);
      for (const entity of entities) {
        parts.push(this.graph.formatSubgraph(entity.id, this.config.maxGraphHops));
      }
    }

    return parts.join("\n\n");
  }
}
```

### 3.4 Prompt 构建器

把向量检索和图谱检索的结果整合成一个结构化的 Prompt。

```typescript
// ============================================================
// graph-rag-prompt-builder.ts — Graph RAG 的 Prompt 模板
// ============================================================

/**
 * Graph RAG Prompt 构建器
 * 
 * 设计原则：
 * 1. 明确告知 LLM 有两类信息来源（文档片段 + 知识图谱）
 * 2. 知识图谱信息是"结构化的、经过验证的关系"——引导 LLM 优先信赖
 * 3. 要求 LLM 标注答案中引用的是哪个来源（便于调试和溯源）
 */
class GraphRAGPromptBuilder {
  /**
   * 构建 Graph RAG 的完整 System Prompt
   */
  buildSystemPrompt(): string {
    return `你是一个基于知识图谱增强的智能问答助手。你的回答将基于两类信息：

## 信息来源
1. **知识图谱（Graph）**：从文档中提取的结构化实体和关系，可靠性高，适合回答"谁"、"什么关系"、"属于哪个"类问题。
2. **文档片段（Text）**：从原始文档中检索的语义相似片段，适合回答"怎么做"、"为什么"、"如何理解"类问题。

## 回答规则
- 优先使用知识图谱信息回答关系型和事实型问题
- 使用文档片段补充细节和上下文
- 如果两类信息来源存在矛盾，以知识图谱为准
- 如果信息不足，明确说"根据已有信息无法确定"
- 在答案末尾标注信息来源（Graph 或 Text）

## 输出格式
1. 直接答案（简洁完整的一句话）
2. 详细解释（2-4 句，引用具体信息）
3. 信息来源标注`;
  }

  /**
   * 构建用户 Prompt（拼接检索结果）
   */
  buildUserPrompt(
    question: string,
    vectorResults: RetrievalItem[],
    graphContext: string
  ): string {
    const parts: string[] = [];

    // 1. 知识图谱信息（如果有）
    if (graphContext) {
      parts.push("## 知识图谱信息（结构化实体关系）");
      parts.push(graphContext);
      parts.push("");
    }

    // 2. 向量检索的文档片段
    if (vectorResults.length > 0) {
      parts.push("## 相关文档片段（语义检索）");
      vectorResults.forEach((item, index) => {
        parts.push(`### 片段 ${index + 1} [相关性: ${(item.score * 100).toFixed(0)}%]`);
        parts.push(item.content);
        parts.push("");
      });
    }

    // 3. 用户问题
    parts.push("## 用户问题");
    parts.push(question);

    return parts.join("\n");
  }

  /**
   * 构建完整的 Chat Messages（System + User）
   */
  buildMessages(
    question: string,
    vectorResults: RetrievalItem[],
    graphContext: string
  ): Array<{ role: "system" | "user"; content: string }> {
    return [
      { role: "system", content: this.buildSystemPrompt() },
      { role: "user", content: this.buildUserPrompt(question, vectorResults, graphContext) },
    ];
  }
}
```

### 3.5 完整的 Graph RAG Pipeline

将所有组件串联起来，提供一个入口函数。

```typescript
// ============================================================
// graph-rag-pipeline.ts — 完整的 Graph RAG 执行管道
// ============================================================

/**
 * Graph RAG 完整流程
 * 
 * 这是一个端到端的示例，展示从文档到答案的完整链路。
 * 生产环境应对每个步骤做错误处理、日志记录和性能监控。
 */
async function graphRAGPipeline(
  question: string,             // 用户问题
  document: string,             // 原始文档（演示用，生产环境来自知识库）
  vectorStore: VectorStore,     // 向量存储
  llmApiKey: string,            // LLM API Key
  model: string = "gpt-4o"      // LLM 模型
): Promise<{
  answer: string;
  sources: { graphItems: number; vectorItems: number };
  stats: { graph: ReturnType<KnowledgeGraph["getStats"]> };
}> {
  // Step 1: 构建知识图谱（离线阶段，这里演示用内联处理）
  console.log("[Pipeline] Step 1: 从文档中提取实体和关系...");
  const extractor = new EntityExtractor(llmApiKey, model);
  const extraction = await extractor.extractFromDocument(document);

  const graph = new KnowledgeGraph();
  graph.buildFromExtraction(extraction);

  // Step 2: 创建混合检索器
  console.log("[Pipeline] Step 2: 执行混合检索...");
  const retriever = new HybridRetriever(graph, vectorStore, llmApiKey, model);

  // Step 3: 混合检索
  const retrievalResults = await retriever.retrieve(question);
  const graphItems = retrievalResults.filter((r) => r.source === "graph");
  const vectorItems = retrievalResults.filter((r) => r.source === "vector");

  // Step 4: 构建 Graph Context
  const entityNames = await retriever.extractQueryEntities(question);
  const graphContext = retriever.getGraphContext(entityNames);

  // Step 5: 构建 Prompt 并调用 LLM
  console.log("[Pipeline] Step 3: 构建 Prompt，调用 LLM 生成答案...");
  const promptBuilder = new GraphRAGPromptBuilder();
  const messages = promptBuilder.buildMessages(question, vectorItems, graphContext);

  const llmClient = new OpenAI({ apiKey: llmApiKey });
  const response = await llmClient.chat.completions.create({
    model,
    messages,
    temperature: 0.3,
  });

  const answer = response.choices[0].message.content || "无法生成答案";

  return {
    answer,
    sources: {
      graphItems: graphItems.length,
      vectorItems: vectorItems.length,
    },
    stats: { graph: graph.getStats() },
  };
}

// ============================================================
// 使用示例
// ============================================================

/*
// 模拟向量存储（生产环境替换为 Pinecone/Weaviate/Qdrant 等）
const mockVectorStore: VectorStore = {
  async search(query: string, topK: number): Promise<RetrievalItem[]> {
    // 这里应替换为真实的向量数据库查询
    return [
      {
        content: "Steve Jobs 是 Apple 的联合创始人，他与 Laurene Powell 于 1991 年结婚。",
        source: "vector",
        score: 0.92,
      },
      {
        content: "Laurene Powell Jobs 是一位慈善家，创立了 Emerson Collective。",
        source: "vector",
        score: 0.85,
      },
    ];
  },
};

const result = await graphRAGPipeline(
  "乔布斯的妻子是谁？",
  "Steve Jobs 于 1976 年与 Steve Wozniak 共同创立了 Apple。他于 1991 年与 Laurene Powell 结婚。Laurene Powell 毕业于斯坦福大学商学院。",
  mockVectorStore,
  process.env.OPENAI_API_KEY!
);

console.log("答案:\n", result.answer);
console.log("来源统计:", result.sources);
console.log("图谱统计:", result.stats.graph);
*/
```

---

## 4. 主流 Graph RAG 方案对比

| 方案 | 语言 | 图谱存储 | 特点 | 适用规模 | 学习曲线 |
|------|------|----------|------|----------|----------|
| **Microsoft GraphRAG** | Python | 文件/Neo4j | 开箱即用，社区摘要 + 全局/局部查询 | 大规模 | 中 |
| **LightRAG** | Python | 内存/Neo4j | 轻量级，图 + 向量双模式检索，速度快 | 中小规模 | 低 |
| **LangChain + Neo4j** | TS/Python | Neo4j | 灵活可组合，但需要自己搭管道 | 灵活 | 中 |
| **自建（本文实现）** | TypeScript | 内存 | 完全可控，适合学习和原型 | 小规模 | 低 |

### 方案推荐

```
你的需求                                      推荐方案
─────────────────────────────────────────────────────────
学习原理、做原型                              自建（本文代码）
小项目、快速验证                               LightRAG
企业级、需要全局分析                            Microsoft GraphRAG
已有 Neo4j 基础设施                             LangChain + Neo4j
纯 TypeScript/Node.js 技术栈                   LangChain TS + Neo4j Aura
```

### 关键库地址

- **Microsoft GraphRAG**: https://github.com/microsoft/graphrag
- **LightRAG** (HKUDS): https://github.com/HKUDS/LightRAG
- **Neo4j + LLM 集成**: https://neo4j.com/docs/
- **LangChain Graph 模块**: https://js.langchain.com/docs/integrations/graphs/neo4j

---

## 5. Graph RAG vs 传统 RAG：决策指南

### 5.1 对比总览

| 维度 | 传统 RAG（纯向量） | Graph RAG |
|------|-------------------|-----------|
| **数据特性** | 非结构化文档为主 | 包含明确实体关系的文本 |
| **关系复杂度** | 低（每个 chunk 独立） | 高（跨 chunk 的实体关联） |
| **典型查询** | "XX 是什么？"、"如何做 YY？" | "A 和 B 什么关系？"、"XX 属于哪个分类？" |
| **对多跳问题的支持** | 弱（需要运气好，相关 chunks 都在 Top-K） | 强（显式关系链路，保证覆盖） |
| **准确率（关系型问题）** | 60-70% | 85-95% |
| **准确率（宽泛问题）** | 85-95% | 80-90%（图谱可能引入噪声） |
| **建库成本** | 低（纯文本 Embedding） | 高（LLM 提取实体 + 构建图谱） |
| **查询延迟** | 低（100-500ms） | 中（500-2000ms，含图谱查询） |
| **增量更新** | 简单（重新 Embedding chunk） | 复杂（需要更新图结构，保持一致性） |
| **维护难度** | 低 | 中高 |
| **存储成本** | 低（向量索引） | 中（向量索引 + 图数据库） |

### 5.2 什么时候用 Graph RAG

```
✅ 应该用 Graph RAG 的场景：
─────────────────────────────────────────
① 你的数据中实体关系很密集
   例：公司年报（股东、子公司、高管任免）
       法律合同（甲乙方、权利义务、条款引用）
       医疗记录（患者-症状-诊断-药物）

② 用户的查询以关系型为主
   例："乔布斯的合伙人是谁？"
       "这个条款适用于哪些情况？"
       "给 XXX 开了什么药？"

③ 需要多跳推理
   例："A 公司的 CEO 同时也是 B 公司的董事会成员吗？"
       这需要 A → CEO → 某个人 → 董事会成员 → B 公司 三跳

④ 数据量不大但关系密集
   如果数据量极大（PB 级），图谱构建和维护成本可能过高问题

─────────────────────────────────────────
❌ 不需要 Graph RAG 的场景：
─────────────────────────────────────────
① 你的数据以"怎么做"类内容为主（教程、代码文档）
② 查询主要是"解释概念"或"总结内容"
③ 数据更新非常频繁（图谱维护成本高）
④ 延迟要求极严格（< 200ms）
```

### 5.3 混合策略（推荐）

**最佳实践是在一个系统中同时支持两种模式**，根据查询类型自动路由：

```typescript
// ============================================================
// 查询路由决策
// ============================================================

/**
 * 判断用户查询是否需要图谱检索
 * 
 * 简单的启发式规则（生产环境可用 LLM 做更准确的分类）：
 * - 包含"关系"、"谁"、"哪个"、"属于"等关键词 → 图谱
 * - 包含"为什么"、"怎么做"、"如何"、"解释"等关键词 → 向量
 */
function needsGraphSearch(question: string): boolean {
  const graphKeywords = [
    "关系", "谁", "哪个", "属于", "关联",
    "上级", "下属", "配偶", "合伙人",
    "归谁管", "在哪", "成立于", "创始人",
  ];

  const vectorKeywords = [
    "为什么", "怎么做", "如何", "解释",
    "介绍一下", "什么是", "怎样", "方法",
    "步骤", "原理", "总结", "概述",
  ];

  const lowerQuestion = question.toLowerCase();

  const graphScore = graphKeywords.filter((kw) => lowerQuestion.includes(kw)).length;
  const vectorScore = vectorKeywords.filter((kw) => lowerQuestion.includes(kw)).length;

  return graphScore > vectorScore;
}

// 在实际的 HybridRetriever 中使用路由
async function smartRetrieve(
  retriever: HybridRetriever,
  question: string
): Promise<RetrievalItem[]> {
  if (needsGraphSearch(question)) {
    // 图谱为主，向量为辅
    console.log("[Router] 检测到关系型查询，优先图谱检索");
    return retriever.retrieve(question);  // 已包含两种检索
  } else {
    // 纯向量检索（跳过图谱，节省延迟和成本）
    console.log("[Router] 检测到概念型查询，仅使用向量检索");
    return retriever["vectorStore"].search(question, 10);
  }
}
```

---

## 6. Graph RAG 的局限与避坑

1. **实体提取质量决定一切**：如果 LLM 提取的实体不全或关系错误，图谱就是垃圾进垃圾出。建议对关键领域做实体词典（预定义实体列表）。
2. **图谱规模膨胀**：随着文档增多，图谱节点和边会快速增长。需要定期清理低频节点和弱关系。
3. **跨语言实体对齐**：中文环境下尤为常见——"Steve Jobs"和"史蒂夫·乔布斯"和"乔帮主"是同一个实体。需要做实体消歧（Entity Disambiguation）。
4. **延迟增加**：图谱查询 + 向量检索 + 合并排序会增加 200-800ms 延迟。对低延迟场景需要做缓存。
5. **评估困难**：Graph RAG 的质量评估比传统 RAG 更复杂——需要评估实体提取准确率、关系召回率、以及最终答案质量三个维度。

---

# 第二部分：DSPy（自动化 Prompt 优化）

## 7. 什么是 DSPy

### 7.1 传统 Prompt 工程的困境

每个做过 AI 应用的人都有这种体验：

```
第一周：认真写 Prompt，跑测试集，准确率 85%
第二周："这里改一下提示词应该能更好" → 准确率 82% ← 退步了
第三周：换个模型试试 → Prompt 效果完全变了 → 重头调整
第四周：需求变了，加了新功能 → 之前的 Prompt 模板不适用了 → 再重写
...
结论：手动调 Prompt 像在沙滩上盖房子
```

**DSPy 的核心观点**：

> "Prompt engineering is not a skill — it's a search problem."

手动写 Prompt 不可规模化。把"找最好的 Prompt"这件事自动化——这就是 DSPy 做的事。

### 7.2 DSPy 不是什么 vs 是什么

```
DSPy 不是：
  ✗ 另一个 Prompt 模板库
  ✗ 一个让你"更好地写 Prompt"的工具
  ✗ LangChain 的替代品

DSPy 是：
  ✓ 一个"编译器"——把声明式的任务描述编译成最优的 Prompt
  ✓ 自动找最佳 few-shot 示例的系统
  ✓ 让你在切换模型时不用重新调 Prompt 的方案
```

### 7.3 核心类比

把 DSPy 类比成深度学习框架：

```
传统深度学习：手调神经网络权重
PyTorch/TensorFlow：定义模型结构 → 自动优化权重

传统 Prompt 工程：手写和修改 Prompt
DSPy：定义"好答案长什么样" → 自动优化 Prompt
```

---

## 8. DSPy 三大核心概念

### 8.1 Signature（签名）

**签名 = 定义"输入什么，输出什么"**

```
传统写法（硬编码 Prompt）：
  "你是一个翻译助手，请把 {english} 翻译成中文。要求：信达雅..."

DSPy 写法（声明式）：
  class Translate(dspy.Signature):
      """把英文翻译成中文"""
      english = dspy.InputField()
      chinese = dspy.OutputField()
```

签名不写提示词细节，只声明：
- 输入字段有哪些
- 输出字段有哪些
- 每个字段的描述（description 是 Field 的一部分）

**为什么签名如此重要**：DSPy 的 compiler 就是基于签名来自动生成和优化 Prompt。你把"要做什么"说清楚，DSPy 自己搞定"怎么说效果最好"。

### 8.2 Module（模块）

**模块 = 定义"用什么推理策略"**

```
常用 Module 及其含义：

dspy.Predict(signature)
  基础预测：输入 → 直接输出
  类比：让 LLM 一次性回答

dspy.ChainOfThought(signature)
  思维链：输入 → Let's think step by step → 输出
  类比：让 LLM 先分析再回答
  适合：需要推理的复杂问题

dspy.ReAct(signature)
  推理+行动：观察 → 思考 → 行动 → 观察 → 思考 → 回答
  类比：Agent 模式，边想边做
  适合：需要用工具、多步操作的任务

dspy.MultiChainComparison(signature)
  多条思维链比较：生成多个推理链 → 投票选出最佳
  类比：多个人各自推理，然后投票决定
  适合：高准确率要求的任务
```

### 8.3 Optimizer（优化器）

**优化器 = 自动找"最好的 Prompt + Few-shot 示例"**

这是 DSPy 最核心的价值所在。

```
主要 Optimizer：

BootstrapFewShot(random_seed=42)
  自动从训练集中选择最优的 few-shot 示例
  "用哪些例子最能教会模型做这个任务？" → DSPy 自己试出来

BootstrapFewShotWithRandomSearch
  在 BootstrapFewShot 的基础上加随机搜索
  探索更大的示例组合空间

MIPROv2
  Meta-ICL Prompt Optimization with Random search
  同时优化 Prompt 指令和 few-shot 示例
  当前 SOTA
```

**优化器的工作流程**：

```
1. 你提供一个训练集 [{输入, 期望输出}, ...]
2. 你提供一个评估指标（怎么算"好"）
3. 优化器运行：
   a. 候选生成：生成多个 Prompt 变体（不同指令、不同示例组合）
   b. 在训练集上评估每个候选
   c. 选得分最高的那个
4. 输出一个优化后的"编译好的程序"（可以直接用）
```

---

## 9. DSPy 工作流（概念 + Node.js 集成）

DSPy 本身是 Python 库，但你可以从 Node.js 调用它。下面展示完整的工作流程。

### 9.1 典型工作流程

```
Step 1: 定义任务（Signature + Module）
  声明输入输出格式和推理策略

Step 2: 准备训练数据
  少量的输入-输出对（通常 50-200 条就够了）

Step 3: 定义评估指标
  什么算"好答案"？语义相似度？精确匹配？人工评分？

Step 4: 选择 Optimizer 并编译
  DSPy 自动搜索最优的 Prompt 和 few-shot 示例

Step 5: 使用编译后的模型
  新问题上调用，获得优化后的结果
```

### 9.2 Python 端（DSPy 服务）

先创建一个小型 DSPy Python 服务，它负责训练优化和推理。

```python
# ============================================================
# dspy_service.py — DSPy 优化服务（Python 端）
# ============================================================
# 启动方式：python dspy_service.py
# 提供 HTTP API 供 Node.js 调用

import dspy
import json
from flask import Flask, request, jsonify

app = Flask(__name__)

# ============================================================
# 1. 配置 LLM（DSPy 需要知道用哪个模型来优化 Prompt）
# ============================================================
# DSPy 支持任何 LiteLLM 兼容的模型
lm = dspy.LM('openai/gpt-4o', api_key='your-api-key')
dspy.configure(lm=lm)

# ============================================================
# 2. 定义任务：英文 → 中文翻译
# ============================================================

class TranslateToChinese(dspy.Signature):
    """将英文文本翻译成自然流畅的中文，保持原文的语气和风格"""
    english_text: str = dspy.InputField(desc="需要翻译的英文原文")
    chinese_text: str = dspy.OutputField(desc="流畅准确的中文翻译")

# ============================================================
# 3. 定义评估指标
# ============================================================
# 这里用一个简化的指标：检查输出不为空且长度合理
# 生产环境应使用 BLEU / COMET 等翻译指标
def translation_metric(example, pred, trace=None):
    """翻译质量评估函数"""
    score = 0.0
    # 基础检查：输出不能为空
    if pred.chinese_text and len(pred.chinese_text) > 0:
        score += 0.3
    # 长度检查：翻译结果不应过短或过长（英文长度的 0.5-3 倍范围）
    expected_len = len(example.english_text)
    actual_len = len(pred.chinese_text)
    if 0.5 * expected_len <= actual_len <= 3 * expected_len:
        score += 0.3
    # 基本质量：不能全是英文或乱码
    chinese_chars = sum(1 for c in pred.chinese_text if '\u4e00' <= c <= '\u9fff')
    if chinese_chars > 0:
        score += 0.4
    return score

# ============================================================
# 4. 编译（训练）优化后的程序
# ============================================================
# 训练数据：少量英文 → 中文的示例对
trainset = [
    dspy.Example(
        english_text="The quick brown fox jumps over the lazy dog.",
        chinese_text="那只敏捷的棕色狐狸跳过了懒狗。"
    ).with_inputs("english_text"),
    dspy.Example(
        english_text="To be, or not to be, that is the question.",
        chinese_text="生存还是毁灭，这是个问题。"
    ).with_inputs("english_text"),
    dspy.Example(
        english_text="Knowledge is power.",
        chinese_text="知识就是力量。"
    ).with_inputs("english_text"),
    dspy.Example(
        english_text="Actions speak louder than words.",
        chinese_text="行动胜于空谈。"
    ).with_inputs("english_text"),
    dspy.Example(
        english_text="Every cloud has a silver lining.",
        chinese_text="黑暗中总有一线光明。"
    ).with_inputs("english_text"),
]

# 使用 ChainOfThought 模块 + BootstrapFewShot 优化器
translate_program = dspy.ChainOfThought(TranslateToChinese)
optimizer = dspy.BootstrapFewShot(metric=translation_metric, max_bootstrapped_demos=4)

# 编译：DSPy 自动选择最优的 few-shot 示例和 Prompt 指令
print("[DSPy] 开始编译优化...")
compiled_program = optimizer.compile(
    student=translate_program,
    trainset=trainset
)
print(f"[DSPy] 编译完成，已优化 Prompt")

# 保存编译后的 Prompt（包含最优指令和示例）
compiled_prompt_template = str(compiled_program)

# ============================================================
# 5. HTTP API 接口
# ============================================================

@app.route("/translate", methods=["POST"])
def translate():
    """翻译接口"""
    data = request.json
    english_text = data.get("text", "")
    if not english_text:
        return jsonify({"error": "缺少 text 参数"}), 400

    result = compiled_program(english_text=english_text)
    return jsonify({
        "chinese_text": result.chinese_text,
        "model_used": "gpt-4o",
        "optimized": True,
    })

@app.route("/inspect_prompt", methods=["GET"])
def inspect_prompt():
    """查看 DSPy 优化后的 Prompt 长什么样"""
    return jsonify({
        "prompt_template": compiled_prompt_template,
        "signature": str(TranslateToChinese),
    })

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "dspy-optimizer"})

if __name__ == "__main__":
    print("[DSPy] 服务已启动，端口: 5050")
    app.run(host="0.0.0.0", port=5050, debug=False)
```

### 9.3 Node.js 端（客户端调用）

```typescript
// ============================================================
// dspy-client.ts — Node.js 调用 DSPy 优化服务
// ============================================================

// DSPy 本身是 Python 库，在 Node.js 中有几种集成方式：
// 1. HTTP API（推荐）：将 DSPy 包装成 HTTP 服务，Node.js 通过 HTTP 调用
// 2. 子进程：用 child_process 调用 Python 脚本
// 3. 直接翻译：把 DSPy 编译出的最优 Prompt 模板导出，在 Node.js 中使用

/**
 * DSPy HTTP 客户端
 * 
 * 设计思路：
 * - DSPy 负责"编译优化"（离线），产生最优的 Prompt 模板和 few-shot 示例
 * - Node.js 负责"推理执行"（在线），用优化好的模板格式化 Prompt 并调用 LLM
 * - 分离优化和推理，降低在线延迟（不需要每次请求都调 DSPy）
 */
class DSPyClient {
  private baseUrl: string;

  constructor(port: number = 5050) {
    this.baseUrl = `http://localhost:${port}`;
  }

  /**
   * 调用 DSPy 优化后的翻译服务
   */
  async translate(text: string): Promise<{
    chineseText: string;
    modelUsed: string;
  }> {
    const response = await fetch(`${this.baseUrl}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`DSPy 服务错误: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return {
      chineseText: data.chinese_text,
      modelUsed: data.model_used,
    };
  }

  /**
   * 获取 DSPy 编译后的 Prompt 模板（用于调试和离线使用）
   */
  async inspectPrompt(): Promise<{
    promptTemplate: string;
    signature: string;
  }> {
    const response = await fetch(`${this.baseUrl}/inspect_prompt`);
    const data = await response.json();
    return {
      promptTemplate: data.prompt_template,
      signature: data.signature,
    };
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      const data = await response.json();
      return data.status === "ok";
    } catch {
      return false;
    }
  }
}

// ============================================================
// 方式二：通过子进程调用 DSPy（适用于一次性编译场景）
// ============================================================

import { spawn } from "child_process";

/**
 * 通过 Node.js 子进程执行 DSPy 编译脚本
 * 
 * 适用场景：在 Node.js 应用启动时或 CI/CD 中执行一次编译，
 * 将结果缓存到文件中，后续直接使用，不需要持续运行 Python 服务
 */
async function compileDSPyViaSubprocess(
  trainingDataPath: string,
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    // 调用 Python 脚本执行编译
    const python = spawn("python", [
      "dspy_compile.py",         // 编译脚本
      "--train", trainingDataPath,  // 训练数据文件
      "--output", outputPath,       // 输出编译结果的文件
    ]);

    let stdout = "";
    let stderr = "";

    python.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    python.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    python.on("close", (code: number) => {
      if (code === 0) {
        console.log("[DSPy] 编译完成");
        resolve(stdout);
      } else {
        reject(new Error(`DSPy 编译失败 (code ${code}): ${stderr}`));
      }
    });

    python.on("error", (err: Error) => {
      reject(new Error(`无法启动 DSPy 进程: ${err.message}`));
    });
  });
}

// ============================================================
// 方式三（推荐）：把 DSPy 编译好的 Prompt 模板直接嵌入 Node.js
// ============================================================

/**
 * 使用 DSPy 优化后的 Prompt 模板
 * 
 * 这是最高效的方式：
 * 1. 离线：用 DSPy 编译优化，导出最优 Prompt 模板
 * 2. 在线：Node.js 加载模板，直接拼接参数后调用 LLM
 * 3. 零额外延迟：不再依赖 Python 服务
 */
class DSPyOptimizedPrompt {
  // 这个模板由 DSPy 的 BootstrapFewShot 自动生成
  // 包含了最优的指令措辞 + 精选的 few-shot 示例
  private static readonly OPTIMIZED_TEMPLATE = `
你是专业的翻译助手。请将以下英文文本翻译成中文。

翻译要求：
- 保持原文的语气和风格
- 使用自然流畅的中文表达
- 不要逐字翻译，要传达原文的意思
- 适当使用中文成语和习语

## 示例
英文：The quick brown fox jumps over the lazy dog.
中文：那只敏捷的棕色狐狸跳过了懒狗。

英文：To be, or not to be, that is the question.
中文：生存还是毁灭，这是个问题。

英文：Actions speak louder than words.
中文：行动胜于空谈。

## 待翻译文本
英文：{english_text}
中文：`;

  /**
   * 用优化后的模板格式化 Prompt
   */
  formatPrompt(englishText: string): string {
    return DSPyOptimizedPrompt.OPTIMIZED_TEMPLATE.replace(
      "{english_text}",
      englishText
    );
  }

  /**
   * 直接使用模板调用 LLM（不依赖 DSPy 运行时）
   */
  async translate(
    client: OpenAI,
    model: string,
    englishText: string
  ): Promise<string> {
    const prompt = this.formatPrompt(englishText);

    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });

    return response.choices[0].message.content?.trim() || "";
  }
}
```

### 9.4 完整的使用示例

```typescript
// ============================================================
// dspy-usage-example.ts — DSPy 完整使用演示
// ============================================================

import OpenAI from "openai";

/**
 * DSPy 使用场景演示
 * 
 * 场景：构建一个产品描述改写服务
 * 目标：把用户输入的产品描述改写成专业的电商文案
 * 
 * 传统做法：
 *   每次改 Prompt → 测几条 → 感觉不够好 → 再改 → 再测 → ...
 *   → 耗时间、不系统、不可重复
 * 
 * DSPy 做法：
 *   准备 50 条 (输入, 期望输出) 训练数据 → DSPy 自动找到最优 Prompt
 *   → 导出一个模板 → 在 Node.js 中直接使用 → 5 分钟搞定
 */

// Step 1: 加载 DSPy 编译好的最优模板（假设已完成编译）
const OPTIMIZED_PRODUCT_TEMPLATE = `你是一名资深电商文案策划师，擅长将产品描述改写成吸引人的营销文案。

## 写作原则
- 突出产品的核心卖点和差异化优势
- 语言要有画面感，让读者产生购买欲望
- 保持简短有力，80-120 字为宜
- 根据目标受众调整语气（年轻人群用活泼风，商务人群用专业风）

## 最佳示例（由 DSPy 自动选出）
=== 示例 1 ===
输入：这款无线耳机续航8小时，支持降噪，售价299元。
输出：告别噪音纷扰，沉浸纯净音乐世界！8小时超长续航，通勤差旅一次搞定。299元就能拥有的旗舰级降噪体验，即刻入手，聆听不一样的精彩！

=== 示例 2 ===
输入：本产品是一个不锈钢保温杯，可以保温12小时。
输出：12小时长效锁温，晨间热咖啡到傍晚依然温暖如初。精选316不锈钢，每一口都是安心。办公桌、健身房、户外徒步——你的全天候补水搭档。

=== 示例 3 ===
输入：我们的这款书桌可以调节高度，适合不同身高的人使用。
输出：告别久坐酸痛，一张懂你的书桌！一键电动升降，站着思考，坐着专注。全家共享，从孩子到老人都能找到最舒适的高度。健康办公，从这张桌开始。

## 现在开始
输入：{input_text}
输出：`;

// Step 2: 在 Node.js 中使用优化后的模板
async function rewriteProductDescription(
  inputText: string,
  apiKey: string
): Promise<string> {
  const client = new OpenAI({ apiKey });
  const prompt = OPTIMIZED_PRODUCT_TEMPLATE.replace("{input_text}", inputText);

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,  // 文案类任务需要一定的创造性
    max_tokens: 200,
  });

  return response.choices[0].message.content?.trim() || "";
}

// 使用示例
/*
const result = await rewriteProductDescription(
  "这个台灯可以调亮度和色温，用手机App控制。",
  process.env.OPENAI_API_KEY!
);
console.log(result);
*/
```

---

## 10. DSPy vs 手动 Prompt 工程：决策指南

### 10.1 什么时候值得用 DSPy

| 场景 | 手动 Prompt | DSPy |
|------|------------|------|
| **一次性脚本/临时任务** | 推荐（手写 5 分钟搞定） | 不值得（搭建成本 > 收益） |
| **需要经常调整的任务** | 痛苦（每次改都要重新测试） | 推荐（重新编译即可） |
| **需要支持多个模型** | 极痛苦（每个模型都不同） | 强项（一键切换模型重编译） |
| **有明确的评估指标** | 可以（但手动试很慢） | 强项（自动搜索最优解） |
| **团队里有人擅长写 Prompt** | 可以考虑 | 互补关系 |
| **团队里没人擅长写 Prompt** | 苦不堪言 | 救星 |
| **任务复杂（多步推理）** | 极高难度 | 天生支持（ReAct/CoT 模块） |
| **数据标注成本高** | 需要少量标注 | 需要 50-200 条训练数据 |
| **延迟敏感（> 500ms 不可接受）** | 无影响 | 编译时耗时，推理时无影响 |
| **频繁切换底层 LLM 提供商** | 灾难 | DSPy 卖点 |

### 10.2 决策矩阵

```
你的情况                                   推荐方案
───────────────────────────────────────────────────────────
做一个 demo，下周上线                      手动写 Prompt
系统需要长期维护，需求会变                  DSPy 优化 + 导出模板
使用单一模型（如只用 GPT-4）               手动可以（DSPy 也有帮助）
需要支持 GPT-4 + Claude + Gemini           强烈推荐 DSPy
任务是翻译/分类/提取（有标准答案）           DSPy（容易定义指标）
任务是创意写作（无标准答案）                手动 + 人工评审
团队有 Python 工程师                        DSPy
纯 Node.js 团队                            手动 + 借鉴 DSPy 思路
预算有限（省 API 调用成本）                 DSPy（优化后 Prompt 更短）
```

### 10.3 一个务实的折中方案

如果你暂时不想引入 Python/DSPy 但希望提高 Prompt 质量：

```typescript
// ============================================================
// 手动版 "Poor Man's DSPy" — 借鉴 DSPy 思想，纯 TypeScript 实现
// ============================================================

/**
 * 用 DSPy 的思路手动优化 Prompt
 * 
 * 核心思想（来自 DSPy 但手动执行）：
 * 1. 准备 20-50 条测试用例
 * 2. 写一个评估函数（什么算"好"）
 * 3. 写 3-5 个 Prompt 变体（不同措辞、不同示例、不同顺序）
 * 4. 自动跑所有变体 vs 所有测试用例，选平均分最高的
 * 
 * 这不是真正的 DSPy，但可以帮你在不引入 Python 的情况下
 * 系统化地选择 Prompt 而不是凭感觉改
 */
async function poorMansDSPy(
  testCases: Array<{ input: string; expectedOutput: string }>,
  promptVariants: string[],  // 不同的 Prompt 模板
  evaluationFn: (predicted: string, expected: string) => number,  // 评分函数
  llmClient: OpenAI,
  model: string
): Promise<{ bestPrompt: string; bestScore: number; allResults: Array<{ prompt: string; score: number }> }> {
  const results: Array<{ prompt: string; score: number }> = [];

  for (const prompt of promptVariants) {
    let totalScore = 0;

    // 对每个测试用例评估
    for (const testCase of testCases) {
      const filledPrompt = prompt.replace("{input}", testCase.input);
      const response = await llmClient.chat.completions.create({
        model,
        messages: [{ role: "user", content: filledPrompt }],
        temperature: 0,
      });

      const predicted = response.choices[0].message.content || "";
      const score = evaluationFn(predicted, testCase.expectedOutput);
      totalScore += score;
    }

    const avgScore = totalScore / testCases.length;
    results.push({ prompt, score: avgScore });
    console.log(`[PoorMansDSPy] Prompt 变体得分: ${avgScore.toFixed(3)}`);
  }

  // 选最佳
  results.sort((a, b) => b.score - a.score);
  return {
    bestPrompt: results[0].prompt,
    bestScore: results[0].score,
    allResults: results,
  };
}

// 使用示例：比较不同 Prompt 变体的效果
/*
const testCases = [
  { input: "今天天气真好", expectedOutput: "positive" },
  { input: "我太失望了", expectedOutput: "negative" },
  { input: "还行吧", expectedOutput: "neutral" },
];

const promptVariants = [
  "判断情感（positive/negative/neutral）：{input} → ",
  "你是情感分析专家。文本：{input}\n情感标签：",
  "Text: {input}\nSentiment (positive, negative, or neutral): ",
];

function simpleEval(predicted: string, expected: string): number {
  return predicted.toLowerCase().includes(expected.toLowerCase()) ? 1 : 0;
}

const result = await poorMansDSPy(testCases, promptVariants, simpleEval, client, "gpt-4o");
console.log("最佳 Prompt:", result.bestPrompt);
*/
```

---

## 11. 总结

### Graph RAG 一句话总结

> 当你的数据中有密集的实体关系，且用户的查询涉及关联和推理时，Graph RAG 是向量 RAG 的必要升级。学它的理由不是因为"高级"，而是因为**传统 RAG 在关系型问题上真的不行**。

### DSPy 一句话总结

> DSPy 把 Prompt 工程从"手工劳动"变成了"搜索问题"。如果你要长期维护一个需要高质量 Prompt 的系统，或者需要支持多模型切换，DSPy 是当前最务实的方案。

### 两者之间的关系

Graph RAG 和 DSPy 解决的是不同层次的问题，但它们可以协同工作：

```
Graph RAG（检索层）     →   解决"找到正确的信息"
   ↓
传统 Prompt（生成层）   →   解决"基于信息产生正确答案"
   ↓
DSPy（优化层）          →   优化"找到信息后如何提问能产出最佳答案"
```

在实际项目中，你可以：
1. 用 **Graph RAG** 提升检索质量（特别是关系型问题）
2. 用 **DSPy 优化后的 Prompt** 提升生成质量
3. 两者叠加：更好的检索 + 更好的 Prompt = 显著提升的端到端效果

---

## 参考资源

- **DSPy GitHub**: https://github.com/stanfordnlp/dspy
- **DSPy 论文**: https://arxiv.org/abs/2310.03714
- **DSPy 官方文档**: https://dspy-docs.vercel.app/
- **Microsoft GraphRAG**: https://github.com/microsoft/graphrag
- **LightRAG (HKUDS)**: https://github.com/HKUDS/LightRAG
- **Neo4j + LLM**: https://neo4j.com/docs/
- **LangChain Graph**: https://js.langchain.com/docs/integrations/graphs/
