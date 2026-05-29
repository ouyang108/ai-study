# 模型选型指南

## 1. 选模型的正确思路

不要只看排行榜！模型选择要考虑实际场景的综合因素：

```
选模型 = f(任务类型, 语言, 延迟要求, 预算, 数据安全, 部署方式)
```

## 2. 主流模型全面对比（2026年5月快照）

> **时效提示**：模型名、上下文、价格、限额变化很快。下面的表用于学习“怎么比较模型”，不要把价格和上下文数字当成长期准确值。上线前必须查供应商最新文档和控制台。

### 2.1 海外闭源模型

| 模型 | 能力 | 速度 | 价格(Input/Output $/1M tokens) | 上下文 | 最适合 |
|------|------|------|------|--------|--------|
| **Claude Opus（最新快照）** | 最强推理 | 中 | 需查官方 | 需查官方 | 复杂推理、代码生成、长文档分析 |
| **Claude Sonnet（最新快照）** | 强推理 | 快 | 需查官方 | 需查官方 | 性价比高的高级模型 |
| **Claude Haiku（最新快照）** | 中等 | 极快 | 需查官方 | 需查官方 | 实时对话、分类、简单任务 |
| **GPT-4o** | 全能 | 快 | 2.50/10 | 128K | 多模态、通用任务 |
| **GPT-4.1** | 强代码 | 中 | 2/8 | 1M | 超长上下文代码 |
| **Gemini 2.5 Pro** | 强推理 | 中 | 1.25/10 | 1M | 超长上下文、多模态 |
| **Gemini 2.5 Flash** | 中等 | 极快 | 0.15/0.60 | 1M | 高吞吐、低成本 |

### 2.2 国内闭源模型

| 模型 | 能力 | 速度 | 价格(￥/1M tokens) | 上下文 | 最适合 |
|------|------|------|------|--------|--------|
| **DeepSeek Chat / V 系列** | 强 | 快 | 需查官方 | 需查官方 | 中文、通用任务、性价比 |
| **DeepSeek Reasoner / R 系列** | 强推理 | 慢 | 需查官方 | 需查官方 | 数学、编程、逻辑推理 |
| **Qwen3-235B** | 全能 | 中 | 4/16 | 128K | 中文长文本、Agent |
| **Qwen3-32B** | 强 | 快 | 0.69/2.76 | 128K | 中等任务性价比 |
| **Kimi K2** | 强 | 快 | 2/8 | 128K | 超长文档、联网搜索 |
| **GLM-4** | 中等 | 快 | 1/4 | 128K | 企业级应用 |

### 2.3 开源模型（本地部署）

| 模型 | 参数量 | 显存需求 | 能力对标 | 最适合 |
|------|--------|----------|----------|--------|
| **DeepSeek-V3** | 671B(MoE) | 多卡(>320GB) | GPT-4o级别 | 最强的开源模型 |
| **Qwen3-235B** | 235B | 多卡(>160GB) | GPT-4级别 | 中文最强开源 |
| **Qwen3-72B** | 72B | 单卡80GB(量化) | GPT-4级别 | 单卡部署最佳 |
| **Qwen3-32B** | 32B | 单卡24GB(量化) | GPT-3.5-Turbo+ | 消费级显卡可用 |
| **Llama 4 Scout** | 109B(MoE) | 多卡 | GPT-4级别 | 英文/多语言 |
| **DeepSeek-R1-Distill-Qwen-32B** | 32B | 单卡24GB | 强推理 | 推理任务性价比 |
| **Mistral Large** | 123B | 多卡(>100GB) | GPT-4级别 | 欧洲市场 |
| **Phi-4** | 14B | 单卡16GB | GPT-3.5级别 | 边缘设备 |

## 3. 按场景选模型

### 3.1 通用对话 / 客服

```
首选: Claude Haiku 最新快照 或 DeepSeek Chat/V 系列
理由: 快 + 便宜 + 中文好
备选: GPT-4o (多模态)、Qwen3-32B (本地部署)
```

### 3.2 复杂推理 / 代码生成

```
首选: Claude Opus 最新快照（质量）或 DeepSeek Reasoner/R 系列（性价比）
理由: 逻辑推理链路长，不能出错
备选: GPT-4o / GPT-4.1、Claude Sonnet 最新快照
```

### 3.3 长文档分析

```
首选: Claude Sonnet 最新快照 或 Gemini 2.5 Pro
理由: 长上下文时注意力保持好，且 Claude 长文本理解业界最佳
备选: Kimi K2 (中文超长)、GPT-4.1 (1M)
```

### 3.4 中文创作 / 翻译

```
首选: DeepSeek Chat/V 系列 或 Qwen3-235B
理由: 中文语感最自然，文言文/古诗词也支持
备选: Claude Sonnet 最新快照（质量好但可能太"翻译腔"）
```

### 3.5 多模态 (图/文/音/视频)

```
首选: Gemini 2.5 Pro (最全面的多模态)
理由: 原生支持图片、视频、音频，不需要额外插件
备选: GPT-4o (图片理解好)、Claude (图片理解强但无音频/视频)
```

### 3.6 本地/私有化部署

```
首选: Qwen3-32B (GPTQ/GGUF 量化)
理由: 中文好、32B 单卡可跑、Apache 2.0 开源协议友好
备选: Llama 4、DeepSeek-R1-Distill-Qwen
```

### 3.7 高并发低延迟

```
首选: Claude Haiku 最新快照 或 Gemini 2.5 Flash
理由: 响应速度毫秒级，单价极低
备选: 本地部署 Qwen3-32B + vLLM 加速
```

## 4. 模型选型决策树

```
你的需求是什么？
├── 最高质量（成本不是问题）
│   ├── 推理/代码 → Claude Opus 最新快照
│   ├── 多模态   → Gemini 2.5 Pro
│   └── 通用     → GPT-4o
│
├── 性价比优先
│   ├── 中文场景 → DeepSeek Chat/V 系列
│   ├── 英文场景 → Claude Sonnet 最新快照
│   └── 超长上下文 → Gemini 2.5 Flash (1M)
│
├── 低延迟/高并发
│   ├── 闭源 → Claude Haiku 最新快照 / Gemini 2.5 Flash
│   └── 开源 → Qwen3-32B + vLLM (本地)
│
├── 私有化部署（数据不出域）
│   ├── 有GPU → Qwen3-72B (量化) 或 DeepSeek-V3 开源权重
│   └── 无GPU → 只能选API，加密传输
│
└── 移动端/边缘设备
    └── Phi-4 (14B) 或 Qwen3-8B 量化版
```

## 5. 模型评测基准（看什么指标）

| 基准 | 测什么 | 关注场景 |
|------|--------|----------|
| **MMLU** | 多学科知识 | 通用能力 |
| **HumanEval** | 代码生成 | 编程 Agent |
| **GSM8K/MATH** | 数学推理 | 数据分析 |
| **C-Eval/CMMLU** | 中文知识 | 中文场景必须看 |
| **MT-Bench** | 多轮对话 | 聊天/客服 |
| **Needle in a Haystack** | 长上下文检索 | 文档分析 |
| **SWE-bench** | 真实代码修复 | 代码 Agent |
| **BFCL (Berkeley Function Calling)** | 工具调用 | Agent 开发必看 |

## 6. 关键提醒

### 6.1 不要只看排行榜
MMLU 高 2 分在实际业务中感知不到。**同一任务自己实测 10 个样本**，比看任何排行榜都靠谱。

### 6.2 成本计算公式

```
月成本 = 日均请求数 × 平均每请求 token × 单价/1M × 30

示例: 假设每天 1 万次对话
- GPT-4o:  10000 × 3000 tokens × ($2.50+$10)/2 /1M × 30 = 约 $93.75/天 = $2812/月
- DeepSeek: 10000 × 3000 tokens × (￥2+￥8)/2 /1M × 30 = 约 ￥150/天 = ￥4500/月
- Claude Haiku: 10000 × 3000 tokens × ($0.80+$4)/2 /1M × 30 = 约 $36/天 = $1080/月
```

> 上面价格只演示公式，不用于采购决策。真实计算时要区分输入价、输出价、缓存价、批处理价、长上下文分层价，以及是否有区域/账号等级差异。

### 6.3 兜底策略（Fallback）

```typescript
// 永远不要只依赖一个模型
const MODEL_FALLBACK = {
    primary: "claude-sonnet-latest",     // 示例别名：生产中替换成供应商官方 model ID
    fallback1: "gpt-4o",                 // 降级方案1（不同供应商）
    fallback2: "deepseek-chat",          // 降级方案2（OpenAI-compatible 服务）
    fallbackLocal: "qwen3-32b-local",    // 终极兜底（本地模型）
};

async function callWithFallback(messages: any[], maxRetries: number = 3): Promise<any> {
    /** 带兜底的模型调用 */
    const modelNames = [
        MODEL_FALLBACK.primary,
        MODEL_FALLBACK.fallback1,
        MODEL_FALLBACK.fallback2,
    ];
    for (const modelName of modelNames) {
        try {
            // 调用大模型，超时时间 30 秒
            return await client.chat(messages, modelName, { timeout: 30 });
        } catch (e: any) {
            // 注意：RateLimitError、Timeout、ConnectionError 等需根据具体 SDK 判断
            logger.warn(`${modelName} 失败: ${e.message}, 尝试下一个`);
            continue;
        }
    }
    throw new Error("所有模型都调用失败");
}
```

## 7. 推荐文章

- [Chatbot Arena (LMSYS)](https://chat.lmsys.org/) — 群众投票的模型排名，比论文靠谱
- [Artificial Analysis](https://artificialanalysis.ai/) — 模型速度/价格/质量对比平台
- [OpenRouter Rankings](https://openrouter.ai/rankings) — 实际使用量排名
- [ollama 可用模型列表](https://ollama.com/search)
