# AI 应用部署与成本优化

> **时效提示**：本文中的模型名、价格、GPU 回本周期都是工程估算示例。真实项目以供应商最新价格、账号限额、区域可用性和实际压测数据为准。

## 第一部分：部署方案对比

### 1. 部署方式全景

| 方式 | 延迟 | 成本 | 数据安全 | 运维难度 | 适用阶段 |
|------|------|------|----------|----------|----------|
| **API 调用 (SaaS)** | 中 | 按量付费 | 数据上云 | 零运维 | 原型/MVP |
| **Serverless GPU** | 中-高 | 按使用量 | 较好 | 低 | 小-中规模 |
| **自建 GPU 服务器** | 低 | 固定成本高 | 最高 | 高 | 大规模/安全要求高 |
| **混合部署** | 灵活 | 最优 | 灵活 | 中 | 生产环境推荐 |

### 2. 各类部署方案详解

#### 2.1 纯 API 调用（最快上手）

```yaml
# 直接用 OpenAI/Claude/DeepSeek 等 API
优点:
  - 零基础设施，10 分钟上线
  - 自动扩容，不需要担心并发
  - 始终用最新的模型
缺点:
  - 数据要发送给第三方（合规风险）
  - 成本不可控（高并发时账单爆炸）
  - 延迟偏高（网络往返 + API 排队）

适合: 原型验证、内部工具、低并发场景
```

#### 2.2 Serverless GPU（按需付费）

```typescript
// 平台选择
const PLATFORMS: Record<string, { 特点: string; 计费: string; 链接: string }> = {
  "Replicate": {
    "特点": "最易用，一行代码部署模型",
    "计费": "按 GPU 秒计费（冷启动 30-60s）",
    "链接": "https://replicate.com/",
  },
  "Modal": {
    "特点": "Pythonic，可以运行任意代码",
    "计费": "按 CPU/GPU 秒计费（冷启动 10-20s）",
    "链接": "https://modal.com/",
  },
  "Together AI": {
    "特点": "专注 LLM 推理，性价比高",
    "计费": "按 token 计费，比 OpenAI 便宜 50-80%",
    "链接": "https://www.together.ai/",
  },
  "Fireworks AI": {
    "特点": "极速推理，比 OpenAI 快 3-5 倍",
    "计费": "按 token 计费",
    "链接": "https://fireworks.ai/",
  },
  "Groq": {
    "特点": "自研 LPU 芯片，推理速度最快",
    "计费": "按 token 计费，极便宜",
    "链接": "https://groq.com/",
  },
  "硅基流动 (SiliconFlow)": {
    "特点": "国内 Serverless GPU，中文模型全",
    "计费": "按 token/秒/张计费",
    "链接": "https://siliconflow.cn/",
  },
};
```

#### 2.3 自建 GPU 服务器

```bash
# 部署架构（以 vLLM + Docker 为例）

# Dockerfile
FROM nvidia/cuda:12.4-runtime-ubuntu22.04

RUN pip install vllm transformers

COPY serve.sh /app/serve.sh

# 启动脚本
# serve.sh
vllm serve Qwen/Qwen2.5-72B-Instruct-AWQ \
  --host 0.0.0.0 \
  --port 8000 \
  --tensor-parallel-size 2 \
  --gpu-memory-utilization 0.90 \
  --max-model-len 8192 \
  --max-num-seqs 256 \
  --enable-prefix-caching

# docker run
docker run --gpus all -p 8000:8000 my-llm-service
```

```yaml
# K8s 部署配置片段
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llm-inference
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: vllm
        image: my-llm-service:latest
        resources:
          limits:
            nvidia.com/gpu: 2  # 需要 2 张 GPU
        ports:
        - containerPort: 8000
        env:
        - name: CUDA_VISIBLE_DEVICES
          value: "0,1"
```

### 3. API 网关与负载均衡

```yaml
# LiteLLM: 统一多模型 API 网关
# 作用: 统一管理多个 LLM 提供商，负载均衡，速率限制，成本追踪

# 启动网关
# litellm --config config.yaml

# config.yaml 示例
model_list:
  - model_name: gpt-4o           # 对外暴露的名称
    litellm_params:
      model: azure/gpt-4o        # 实际调用的模型
      api_key: ${AZURE_API_KEY}
      api_base: ${AZURE_API_BASE}
  - model_name: claude-sonnet
    litellm_params:
      model: "claude/<替换为官方Claude快照ID>"
      api_key: ${ANTHROPIC_API_KEY}

# 路由策略
router_settings:
  routing_strategy: "latency-based" # 延迟最低优先
  # routing_strategy: "cost-based"   # 成本最低优先
  # routing_strategy: "usage-based"  # 负载最低优先
  allowed_fails: 3
  num_retries: 2
  fallbacks:
    - gpt-4o: ["claude-sonnet"]     # GPT-4o 挂了自动切 Claude

# 使用（和 OpenAI 完全一样的调用方式）
# const client = new OpenAI({ baseURL: "http://localhost:4000/v1", apiKey: "xxx" });
```

**LiteLLM 代理的核心价值**:
- 一套 API 对接所有模型供应商
- 自动故障转移和重试
- 成本追踪和分析
- 速率限制和预算控制
- 团队 API Key 管理

**GitHub**: https://github.com/BerriAI/litellm

---

## 第二部分：成本优化

### 4. 成本构成分析

```
AI 应用总成本 = LLM API 调用 + 基础设施 + 人力 + 数据

LLM API 调用（通常占 60-80%）:
├── 生产环境的正常请求
├── 重试/错误恢复的额外调用
├── Agent 多步推理的累积消耗
└── 开发/测试期间的实验消耗

基础设施（通常占 10-20%）:
├── API 网关服务器
├── 数据库（向量库 + 业务库）
├── 缓存（Redis）
└── 监控和日志

人力（通常占 10-20%）:
└── 持续的 Prompt 调优和模型评估
```

### 5. 10 条成本优化策略

#### 策略1: 选对模型

```typescript
// ❌ 用 GPT-4o 做情感分类
const badResponse = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [...],
});  // $2.50/1M input

// ✅ 用便宜的快速模型或 DeepSeek 做情感分类
// 这里保留 chat.completions.create() 是为了兼容 DeepSeek、LiteLLM、vLLM 等 OpenAI-compatible 服务
const goodResponse = await client.chat.completions.create({
  model: "deepseek-chat",
  messages: [...],
});

// 节省: 70%
```

#### 策略2: 语义缓存

```
# 见 12-缓存与流式-Caching-Streaming.md
# 相似问题返回缓存结果，命中率 20-40%
# 节省: 20-40% 的 API 调用
```

#### 策略3: Prompt 压缩

```typescript
// ❌ 把 10 页 PDF 全塞进 Prompt
const context = fullPdfContent;  // 15000 tokens

// ✅ 只放最相关的段落
const relevantChunks = await vectorStore.search(query, 3);  // 1500 tokens

// 节省: 90% 的 Input Token
```

#### 策略4: 使用 Prompt Cache

```
# 见 12-缓存与流式-Caching-Streaming.md
# 长 System Prompt 加 cache_control 标记
# 节省: System Prompt 部分 90% 成本
```

#### 策略5: 降低 Max Tokens 限制

```typescript
// ❌ max_tokens=4096，实际只用 200
// ✅ max_tokens=500，用完就停

const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [...],
  max_tokens: 500,  // 限制输出长度
});

// 节省: 不是直接省钱，而是防止意外超支
// 某些模型按实际输出计费，但限制最大值能防止"暴走"
```

#### 策略6: 批处理 + 异步并发

```typescript
// ❌ 同步串行: 100 个请求，每个 2 秒 = 200 秒
// ✅ 异步并发: 100 个请求，20 秒全部完成（受 API 速率限制）

import pLimit from "p-limit";

/**
 * 批量异步处理，保持合理并发
 */
async function batchProcess(items: any[], concurrency: number = 20): Promise<any[]> {
  const limit = pLimit(concurrency);

  // 为每个 item 创建受并发限制的异步任务
  const tasks = items.map(item =>
    limit(() => callLLMAsync(item))  // callLLMAsync 是你的异步 LLM 调用函数
  );

  return await Promise.all(tasks);
}

// 注意: 并发不等于省钱（总 token 数一样），但用户体验好
```

#### 策略7: 短模型用本地部署

```typescript
// 简单任务（分类、摘要、翻译）用本地小模型
// 预算: 一块 RTX 4090 (~¥12000) 可以 7×24 运行 Qwen3-32B
// vs API: 如果每天 100 万 tokens，API 每月花费 ~$80+
// 回本周期: 约 6-12 个月（仅算 API 费用）

// 本地部署做"筛子"：简单任务本地处理，复杂任务才调 API
// 使用 vLLM（本地 Python 服务）或 Ollama 提供本地推理接口

/**
 * 智能路由：简单任务本地处理，复杂任务调 API
 */
async function smartRoute(query: string, localLLMUrl: string): Promise<string> {
  // 小模型判断复杂度（调用本地部署的模型 API）
  const complexity = await callLocalLLM(
    localLLMUrl,
    `评估以下问题的复杂度（简单/中等/复杂）：${query}`
  );

  if (complexity.includes("简单")) {
    return await callLocalLLM(localLLMUrl, query);  // 本地免费处理
  } else {
    return await callCloudAPI(query);  // 调大模型
  }
}
```

#### 策略8: 设置预算告警和硬限制

```typescript
/**
 * 追踪和限制 API 花费
 */
class BudgetTracker {
  private dailyLimit: number;
  private todayCost: number = 0;
  private todayDate: string | null = null;

  // 各模型价格表 ($/1M tokens)
  // 注意：这是演示用快照。生产环境请从配置中心维护价格，不要硬编码在业务代码里。
  private static readonly PRICES: Record<string, [number, number]> = {
    "gpt-4o": [2.50, 10.00],
    "claude-sonnet": [3.00, 15.00],
    "claude-haiku": [0.80, 4.00],
    "deepseek-chat": [0.27, 1.10],  // 示例换算
  };

  constructor(dailyLimit: number = 50.0) {
    this.dailyLimit = dailyLimit;
  }

  /**
   * 每次 API 调用前检查预算
   */
  checkAndTrack(model: string, inputTokens: number, outputTokens: number): number {
    const today = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD

    // 新的一天，重置
    if (today !== this.todayDate) {
      this.todayCost = 0;
      this.todayDate = today;
    }

    // 计算本次费用
    const cost = this.calcCost(model, inputTokens, outputTokens);

    // 超预算？拒绝
    if (this.todayCost + cost > this.dailyLimit) {
      throw new Error(
        `今日预算 ${this.dailyLimit} 元即将超支`
      );
    }

    this.todayCost += cost;
    return cost;
  }

  /**
   * 计算单次调用的费用
   */
  private calcCost(model: string, inTokens: number, outTokens: number): number {
    // 获取模型价格，默认 $1/$5 per 1M tokens
    const [inPrice, outPrice] = BudgetTracker.PRICES[model] ?? [1, 5];
    return (inTokens * inPrice + outTokens * outPrice) / 1_000_000;
  }
}
```

#### 策略9: 输出长度控制

```typescript
// 不光是 max_tokens，还要在 Prompt 中限制
const prompt = `
回答以下问题，要求：
- 总共不超过 200 字
- 只说关键信息，不铺陈背景
- 如果一句话能说清，就说一句话

问题：${question}
`;
// 经验: Prompt 中写 "不超过X字" 比单纯设 max_tokens 更有效
```

#### 策略10: 使用 Fine-tuned 小模型替代大模型

```typescript
// 场景: 某电商平台的商品描述生成
// ❌ 用 GPT-4o（通用模型，$2.50/1M input → 效果好但贵）
// ✅ 用 Qwen2.5-7B + 微调（专用模型，本地免费 → 效果接近且免费）

// 微调成本: 收集 200 条高质量标注数据 + 训练 30 分钟
// vs API 成本: 每天生成 1 万条描述时的 API 费用
// ROI: 2-4 周回本
```

### 6. 成本优化速查表

| 优化措施 | 预期节省 | 实施难度 | 副作用 |
|----------|----------|----------|--------|
| 换成便宜模型 | 30-70% | 低 | 质量可能下降 |
| 语义缓存 | 20-40% | 中 | 可能返回过期内容 |
| RAG 替代全量上下文 | 50-80% | 中 | 检索可能不精确 |
| Prompt Cache | 10-30% | 低 | 缓存时间短 |
| 本地小模型兜底 | 20-50% | 高 | 需 GPU 硬件 |
| 限制 max_tokens | 10-20% | 低 | 可能截断回答 |
| 精简 System Prompt | 5-15% | 低 | 无 |
| 设置预算硬限制 | 防止超支 | 低 | 高峰期可能拒绝服务 |

---

## 7. 推荐文章

- [LiteLLM](https://github.com/BerriAI/litellm) — 多模型 API 网关
- [OpenRouter](https://openrouter.ai/) — 多模型聚合 API
- [One API](https://github.com/songquanpeng/one-api) — 国内多模型管理
- [LobeChat 自部署](https://github.com/lobehub/lobe-chat)
- [vLLM 生产部署指南](https://docs.vllm.ai/en/stable/serving/deploying_with_docker.html)
- [Modal Guide](https://modal.com/docs/guide)
- [LangFuse 成本追踪](https://langfuse.com/docs/token-usage)
