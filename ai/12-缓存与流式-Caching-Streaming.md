# 缓存策略与流式输出

## 第一部分：缓存策略

### 1. 为什么需要缓存

LLM API 调用又慢又贵。很多场景下用户的请求是重复或高度相似的，缓存能直接省下钱和延迟。

```
场景估算：客服系统每天 10 万次对话
- 30% 的问题高度相似（如"如何退款"）
- 缓存命中后：0 API 调用、延迟 <10ms、成本 = 0
- 每天节省: 100000 × 30% × $0.003 = $90/天 = $2700/月
```

### 2. 缓存层级设计

```
┌──────────────────────────────────────┐
│  L1: 精确匹配缓存 (Exact Match)       │ ← 最快，命中率低
│  用户输入完全相同 → 直接返回缓存结果    │
├──────────────────────────────────────┤
│  L2: 语义缓存 (Semantic Cache)        │ ← 核心层，命中率高
│  用户输入语义相似 → 返回缓存结果        │
├──────────────────────────────────────┤
│  L3: Prompt Cache (API 层)           │ ← 减少 Input Token 成本
│  System Prompt 不变 → 复用 KV Cache   │
└──────────────────────────────────────┘
```

### 3. 精确匹配缓存（L1）

```typescript
import crypto from "crypto";
import Redis from "ioredis";

// === 方案A: 内存缓存（单进程） ===
// 使用 Map 实现简单 LRU（生产环境推荐使用 lru-cache npm 包: npm install lru-cache）
const llmCache = new Map<string, any>();
const MAX_CACHE_SIZE = 1000;

function cachedLlmCall(promptHash: string): any | undefined {
    /** 简单的内存缓存 — 先查缓存，命中直接返回 */
    return llmCache.get(promptHash);
}

function setCachedLlmCall(promptHash: string, result: any): void {
    /** 写入内存缓存 */
    if (llmCache.size >= MAX_CACHE_SIZE) {
        // 删除最早的条目（简化版 LRU 淘汰策略）
        const firstKey = llmCache.keys().next().value;
        if (firstKey !== undefined) llmCache.delete(firstKey);
    }
    llmCache.set(promptHash, result);
}

// === 方案B: Redis 缓存（分布式） ===
class ExactMatchCache {
    /** 精确匹配缓存 — 最简单的缓存策略 */

    private redis: Redis;
    private ttl: number;

    constructor(redisClient: Redis, ttl: number = 3600) {
        this.redis = redisClient;
        this.ttl = ttl;  // 缓存过期时间（秒）
    }

    private hash(messages: object[], model: string): string {
        /** 对整个请求做哈希 */
        const content = JSON.stringify(messages, Object.keys(messages).sort()) + model;
        return crypto.createHash("md5").update(content, "utf8").digest("hex");
    }

    async get(messages: object[], model: string): Promise<string | null> {
        /** 查询缓存 */
        const key = `llm_cache:${this.hash(messages, model)}`;
        const cached = await this.redis.get(key);
        if (cached) {
            await this.redis.expire(key, this.ttl);  // 续期
            return cached;  // ioredis 返回 string，无需 decode
        }
        return null;
    }

    async set(messages: object[], model: string, response: string): Promise<void> {
        /** 写入缓存 */
        const key = `llm_cache:${this.hash(messages, model)}`;
        await this.redis.setex(key, this.ttl, response);
    }
}

// 使用示例
// const cache = new ExactMatchCache(redisClient);
// const cached = await cache.get(messages, "gpt-4o");
// if (cached) {
//     return cached;  // 直接返回，0 成本
// }
// const response = await callLlm(messages);  // 实际调用
// await cache.set(messages, "gpt-4o", response);
```

**优点**: 实现简单，100% 准确（不会返回错误结果）
**缺点**: 命中率低，用户换个说法就匹配不上了

### 4. 语义缓存（L2）— 重点推荐

```typescript
import crypto from "crypto";
import Redis from "ioredis";
import { pipeline } from "@xenova/transformers";

class SemanticCache {
    /** 语义缓存 — 相似的问题返回同样的答案 */

    private redis: Redis;
    private threshold: number;
    private encoder: any;  // @xenova/transformers pipeline

    constructor(redisClient: Redis, similarityThreshold: number = 0.92) {
        this.redis = redisClient;
        this.threshold = similarityThreshold;
        // 注意: 用 small 模型做缓存检查，不要用大模型增加额外成本
        // @xenova/transformers 会在首次调用时自动下载模型
    }

    async init(): Promise<void> {
        // 初始化中文 Embedding 模型（BGE-small，轻量高效）
        this.encoder = await pipeline(
            "feature-extraction",
            "Xenova/bge-small-zh-v1.5"
        );
    }

    async get(userQuery: string): Promise<string | null> {
        /** 查找语义相似的缓存结果 */
        const queryOutput = await this.encoder(userQuery, {
            pooling: "mean",
            normalize: true,
        });
        const queryVec: Float32Array = queryOutput.data;

        // 从 Redis 中获取所有缓存的 key（生产环境应使用向量数据库如 Milvus/Qdrant）
        const cachedKeys = await this.redis.keys("sem_cache:*");
        if (!cachedKeys || cachedKeys.length === 0) {
            return null;
        }

        // 批量计算相似度，找最佳匹配
        let bestScore = 0;
        let bestKey: string | null = null;
        for (const key of cachedKeys) {
            // 读取二进制向量数据
            const cachedVecBuffer = await this.redis.hgetBuffer(key, "vector");
            if (!cachedVecBuffer) continue;
            const cachedVec = new Float32Array(
                cachedVecBuffer.buffer,
                cachedVecBuffer.byteOffset,
                cachedVecBuffer.length / 4
            );
            const score = cosineSimilarity(queryVec, cachedVec);
            if (score > bestScore) {
                bestScore = score;
                bestKey = key;
            }
        }

        if (bestScore >= this.threshold && bestKey) {
            return await this.redis.hget(bestKey, "response");
        }
        return null;
    }

    async set(userQuery: string, response: string): Promise<void> {
        /** 存储缓存 */
        const queryOutput = await this.encoder(userQuery, {
            pooling: "mean",
            normalize: true,
        });
        const queryVec: Float32Array = queryOutput.data;
        const key = `sem_cache:${crypto.createHash("md5").update(userQuery, "utf8").digest("hex").slice(0, 12)}`;

        // 使用 pipeline 批量写入
        await this.redis
            .pipeline()
            .hset(key, "query", userQuery)
            .hset(key, "response", response)
            .hset(key, "vector", Buffer.from(queryVec.buffer))
            .expire(key, 3600)  // 1 小时过期
            .exec();
    }
}

// 手动实现余弦相似度（替代 numpy）
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

**优点**: 命中率高，用户换种说法也能命中
**缺点**: 多了 Embedding 计算成本（但远低于 LLM 调用）；可能错误返回（相似但实际不同的问题）

**阈值调优经验**:
```typescript
// similarity_threshold 选择指南
// 0.98 → 几乎不会出错，命中率低（适合金融、医疗等不能出错的场景）
// 0.92 → 推荐值，平衡命中率和准确性
// 0.85 → 命中率高，但可能把"如何退款"和"如何换货"搞混
// 0.75 → 不做语义缓存，直接用 RAG
```

### 5. Prompt Cache（L3）— API 层面的优化

```typescript
// Anthropic 的 Prompt Caching: 给 System Prompt 加标记，复用 KV Cache
// 适合: System Prompt 很长且相对固定的场景

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// 标记哪些内容可以被缓存（加 cache_control）
const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    system: [
        {
            type: "text",
            text: "你是一个..." + "很长的 system prompt".repeat(100),
            cache_control: { type: "ephemeral" },  // ← 标记缓存
        },
    ],
    messages: [{ role: "user", content: "问题..." }],
    max_tokens: 1024,
});

// 效果:
// - System Prompt 部分的 Input Token 成本降低 90%
// - 延迟降低（不用重新计算 KV Cache）
// - 缓存有效期: 5 分钟（每次使用续期）
//
// 什么时候用:
// ✅ System Prompt > 1024 tokens
// ✅ 对话中反复使用相同的工具定义
// ✅ 多轮对话中注入相同的长文档
// ❌ System Prompt 每次都变化
```

**OpenAI 对应的功能**: Automatic Prompt Caching（自动，不需要手动配置）

**优点**: 直接在 API 层面省钱，零代码改动（OpenAI）；Anthropic 需要加标记
**缺点**: 缓存时间短（5-10分钟），适合高并发场景，不适合低频使用

### 6. 缓存方案对比

| 方案 | 命中率 | 准确性 | 延迟 | 成本节省 | 实现难度 |
|------|--------|--------|------|----------|----------|
| 精确匹配 | 低（5-10%） | 100% | <1ms | 低 | 极低 |
| 语义缓存 | 高（20-40%） | 95-99% | ~10ms | 高 | 中 |
| Prompt Cache | 取决于场景 | 100% | 减少30-50% | 中（仅省Input） | API原生 |
| 三者组合 | 最高（30-50%） | 高 | <10ms/中等 | 最高 | 中高 |

---

## 第二部分：流式输出（Streaming）

### 7. 为什么需要 Streaming

| 场景 | 非流式 | 流式 |
|------|--------|------|
| 生成 1000 字 | 等 8 秒，一次性返回 | 0.5 秒出第一个字，持续输出 |
| 用户感知延迟 | 高（看着白屏等待） | 低（看到字在跳动） |
| 用户体验 | 差 | 好（像 ChatGPT 那样逐字输出） |
| 实现难度 | 简单 | 中等 |

### 8. 流式输出实现

```typescript
// === OpenAI 流式调用 ===
import OpenAI from "openai";

const client = new OpenAI();

const stream = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: "写一首关于AI的诗" }],
    stream: true,  // ← 开启流式
});

// 逐 token 输出
for await (const chunk of stream) {
    if (chunk.choices[0]?.delta?.content) {
        process.stdout.write(chunk.choices[0].delta.content);
    }
}

// === Express 流式 API（替代 FastAPI） ===
import express, { Request, Response } from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

async function* generateStream(userMessage: string): AsyncGenerator<string> {
    /** 生成流式响应（async generator 替代 Python async yield） */
    const stream = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: userMessage }],
        stream: true,
    });
    for await (const chunk of stream) {
        if (chunk.choices[0]?.delta?.content) {
            // SSE 格式
            yield `data: ${JSON.stringify({ content: chunk.choices[0].delta.content })}\n\n`;
        }
    }
    yield "data: [DONE]\n\n";
}

app.post("/chat/stream", async (req: Request, res: Response) => {
    const { message } = req.body;

    // 设置 SSE 响应头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");  // Nginx 禁用缓冲
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();  // 立即发送响应头

    for await (const chunk of generateStream(message)) {
        res.write(chunk);
    }
    res.end();
});

app.listen(3000, () => {
    console.log("SSE streaming server running on http://localhost:3000");
});
```

```typescript
// === Anthropic 流式调用 ===
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const stream = client.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{ role: "user", content: "写一首关于AI的诗" }],
});

// 逐 token 输出（Anthropic SDK 的流式事件）
for await (const event of stream) {
    if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
    ) {
        process.stdout.write(event.delta.text);
    }
}

// 获取最终完整消息
const finalMessage = await stream.finalMessage();
console.log("\n\n完整响应:", finalMessage.content);
```

### 9. 流式输出的常见坑

```typescript
// 坑1: Nginx 缓冲导致"假非流式"
// Nginx 默认会缓冲响应，导致流式变成一次性返回
// 解决: 加 header "X-Accel-Buffering: no" 或 Nginx 配置 proxy_buffering off

// 坑2: 函数调用 + 流式不能直接配合
// 当模型返回的是 tool_calls 而不是 content，需要特殊处理
let accumulatedArgs = "";
for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.tool_calls) {
        // 累积 tool_call 的 JSON 片段
        accumulatedArgs += delta.tool_calls[0]?.function?.arguments ?? "";
    } else if (delta?.content) {
        // 处理文本内容
        process.stdout.write(delta.content);
    }
}

// 坑3: 前端 SSE 断连
// 浏览器对 SSE 连接有限制（同域名 6 个连接）
// 解决: 用 HTTP/2 或 WebSocket

// 坑4: 流式 + RAG 的"引用"问题
// 流式输出时，引用标记（如 [1]）可能出现在不同 chunk 中
// 解决: 后处理阶段统一渲染引用，不要逐 chunk 处理
```

### 10. 流式 vs 非流式 选型

| 场景 | 推荐 | 原因 |
|------|------|------|
| 对话/聊天 | 流式 | 用户体验好，感知延迟低 |
| 代码生成 | 流式 | 看着代码逐行出现体验好 |
| API 对 API 调用 | 非流式 | 不需要展示给用户，流式增加复杂度 |
| 批量处理 | 非流式 | 处理完整结果更方便 |
| JSON 结构化输出 | 非流式 | 流式返回的 JSON 可能不完整 |
| Agent 工具调用 | 非流式 | 需要完整解析 function call |
| 实时字幕/翻译 | 流式 | 必须流式，否则无法用 |

## 11. 推荐文章

### 缓存
- [Anthropic Prompt Caching 文档](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
- [OpenAI Prompt Caching](https://platform.openai.com/docs/guides/prompt-caching)
- [GPTCache (语义缓存框架)](https://github.com/zilliztech/GPTCache)
- [Redis + LLM Caching 最佳实践](https://redis.io/solutions/llm-caching/)

### 流式
- [OpenAI Streaming Guide](https://platform.openai.com/docs/api-reference/streaming)
- [Server-Sent Events 规范](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [FastAPI Streaming 文档](https://fastapi.tiangolo.com/advanced/custom-response/#streamingresponse)
