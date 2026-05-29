# AI 幻觉（Hallucination）处理详解

## 1. 什么是 AI 幻觉

AI 幻觉（Hallucination）指的是 LLM 生成的内容**看起来合理、流畅，但实际上与事实不符、无中生有或逻辑矛盾**。这是当前所有大语言模型都面临的固有问题。

### 1.1 幻觉的类型

| 类型 | 说明 | 示例 |
|------|------|------|
| **事实性幻觉** | 编造不存在的事实 | "《红楼梦》的作者是鲁迅" |
| **忠实性幻觉** | 输出与用户输入不一致 | 用户输入"写一篇200字文章"，输出500字 |
| **逻辑性幻觉** | 推理过程存在矛盾 | "因为下雨，所以今天很干燥" |
| **来源性幻觉** | 编造不存在的引用 | 引用一篇不存在的论文或网页 |
| **数值性幻觉** | 编造数据/数字 | "该产品销量增长327%" |

### 1.2 幻觉的成因

```
1. 训练数据问题
   ├── 训练数据包含错误信息
   ├── 数据中存在矛盾信息
   └── 知识截止日期后的信息空白

2. 模型架构问题
   ├── 自回归生成的错误累积（一步错步步错）
   ├── 概率采样导致的不确定性
   └── 模型本质是"预测下一个token"而非"检索事实"

3. 推理环节问题
   ├── 缺乏事实核查机制
   ├── 过度自信（不会说"我不知道"）
   └── 上下文过长导致注意力分散
```

## 2. 幻觉检测方法

### 2.1 人工检测维度

| 检测维度 | 检查问题 |
|----------|----------|
| 事实准确性 | 陈述的事实是否可验证？ |
| 逻辑一致性 | 前后是否有矛盾？ |
| 来源可追溯 | 引用的数据/文章是否存在？ |
| 时效性 | 信息是否过时？ |
| 完整性 | 是否遗漏重要信息？ |

### 2.2 自动检测方法

```typescript
/**
 * 计算两个字符串的相似度（基于 Levenshtein 编辑距离）
 * 返回值 0-1，越高越相似
 */
function stringSimilarity(a: string, b: string): number {
    if (a === b) return 1.0;
    if (a.length === 0 || b.length === 0) return 0.0;

    // 构建编辑距离矩阵
    const matrix: number[][] = [];
    for (let i = 0; i <= a.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= b.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,       // 删除
                matrix[i][j - 1] + 1,       // 插入
                matrix[i - 1][j - 1] + cost // 替换
            );
        }
    }

    const distance = matrix[a.length][b.length];
    const maxLen = Math.max(a.length, b.length);
    return maxLen === 0 ? 1.0 : 1 - distance / maxLen;
}

interface SelfConsistencyResult {
    answers: string[];
    consistencyScore: number;
    isLikelyHallucination: boolean;
}
```

```typescript
// 方法1：自我一致性检查（Self-Consistency）
function selfConsistencyCheck(
    llm: any,
    question: string,
    nSamples: number = 5
): SelfConsistencyResult {
    /** 让模型多次回答同一问题，检查答案一致性 */
    const answers: string[] = [];
    for (let i = 0; i < nSamples; i++) {
        const answer = llm.ask(question, { temperature: 0.7 });  // 较高温度增加多样性
        answers.push(answer);
    }

    // 计算答案的相似度/一致性
    const similarities: number[] = [];
    for (let i = 0; i < answers.length; i++) {
        for (let j = i + 1; j < answers.length; j++) {
            const sim = stringSimilarity(answers[i], answers[j]);
            similarities.push(sim);
        }
    }

    const avgSimilarity = similarities.reduce((sum, s) => sum + s, 0) / similarities.length;
    return {
        answers,
        consistencyScore: avgSimilarity,  // 越高越一致
        isLikelyHallucination: avgSimilarity < 0.6  // 一致性低可能是幻觉
    };
}
```

```typescript
// 方法2：NLI（自然语言推理）进行事实核查
interface NLIFactCheckResult {
    label: string;       // entailment(支持) / contradiction(矛盾) / neutral(中立)
    confidence: number;
    isSupported: boolean;
}

function nliFactCheck(claim: string, evidence: string): NLIFactCheckResult {
    /**
     * 使用 NLI 模型检查声称(claim)是否被证据(evidence)支持
     * 可用 NLI 模型：
     * - roberta-large-mnli
     * - deberta-v3-large-nli
     * - GPT-4 as judge
     */
    const result = nliModel(claim, evidence);
    return {
        label: result.label,           // entailment/contradiction/neutral
        confidence: result.score,
        isSupported: result.label === "entailment"
    };
}
```

```typescript
// 方法3：LLM-as-Judge（用另一个 LLM 当裁判）
function llmJudgeCheck(generatedText: string): Record<string, any> {
    /** 用 GPT-4/Claude 作为裁判，检查幻觉 */
    const judgePrompt = `你是一位严格的事实核查员。请检查以下AI生成的内容：

${generatedText}

请逐一检查：
1. 每个事实性陈述是否准确？（如日期、人名、数据）
2. 引用的来源是否真实存在？
3. 逻辑推理是否有矛盾？
4. 是否有无中生有的信息？

对于每个问题，标注严重程度：
- CRITICAL: 明显的事实错误
- WARNING: 可能不准确，需要人工核实
- OK: 信息正确

最后给出整体幻觉评分（0-100，越低幻觉越少）`;

    return llm.judge(judgePrompt);
}
```

### 2.3 开源幻觉检测工具

| 工具 | 说明 | 地址 |
|------|------|------|
| **SelfCheckGPT** | 基于自我一致性的幻觉检测 | [GitHub](https://github.com/potsawee/selfcheckgpt) |
| **LangCheck** | 多语言 LLM 输出质量检查 | [GitHub](https://github.com/citadel-ai/langcheck) |
| **G-Eval** | 基于 GPT 的评估框架 | [论文](https://arxiv.org/abs/2303.16634) |
| **RAGAS** | RAG 系统评估框架，含幻觉检测 | [GitHub](https://github.com/explodinggradients/ragas) |
| **DeepEval** | LLM 评估框架 | [GitHub](https://github.com/confident-ai/deepeval) |
| **TruLens** | LLM 应用可观测性 | [GitHub](https://github.com/truera/trulens) |
| **FacTool** | 事实性检测工具 | [GitHub](https://github.com/GAIR-NLP/factool) |

## 3. 缓解幻觉的策略

### 3.1 RAG（检索增强生成）— 最有效的方法

```
用户问题 → 检索相关文档 → 将文档作为上下文注入 → LLM 基于文档回答
                                       ↓
                              答案受限于检索到的文档
                              大大减少编造空间
```

详见 [06-RAG 文档](./06-检索增强生成-RAG.md)。

### 3.2 Grounding（事实锚定）

在 Prompt 中显式要求模型基于提供的材料回答：

```markdown
## 规则
- 只能基于下面提供的内容回答问题
- 如果信息不足，直接回答"根据现有信息无法回答"
- 不要添加任何外部知识

## 参考内容
{检索到的文档内容}

## 问题
{用户问题}
```

### 3.3 Chain-of-Verification (CoVe) — 验证链

让模型自我验证生成的内容：

```
Step 1: 生成初始回答
Step 2: 针对回答中的每个事实点生成验证问题
Step 3: 独立回答每个验证问题（不带原回答上下文）
Step 4: 对比验证结果，修正原回答中的不一致之处
```

**论文**: [Chain-of-Verification Reduces Hallucination](https://arxiv.org/abs/2309.11495)

伪代码实现：

```typescript
async function chainOfVerification(llm: any, question: string): Promise<string> {
    /** CoVe 流程 */
    // Step 1: 生成初始回答
    const draft = await llm.ask(question);

    // Step 2: 生成验证问题
    const verifyQuestions: string[] = await llm.ask(`根据以下回答，生成需要验证的问题：
回答：${draft}
为每个事实陈述生成一个验证问题。`);

    // Step 3: 独立验证（不带原始上下文，避免偏见）
    const verifiedFacts: string[] = [];
    for (const q of verifyQuestions) {
        const fact = await llm.ask(q);  // 独立查询
        verifiedFacts.push(fact);
    }

    // Step 4: 对比修正
    const finalAnswer = await llm.ask(`原始回答：${draft}
验证结果：${verifiedFacts.join("\n")}
请根据验证结果修正原始回答中的错误，生成最终回答。`);

    return finalAnswer;
}
```

### 3.4 温度与采样参数调节

> **注意**：以下参数仅适用于**标准模型**（GPT-4o、Claude Sonnet、DeepSeek-V3 等）。
> **推理模型不支持 temperature/topP**，而是用各厂商自己的参数控制推理深度，且本身确定性更强，天然幻觉率更低：
> - OpenAI o1/o3 → `reasoning_effort: "low"/"medium"/"high"` ([文档](https://platform.openai.com/docs/guides/reasoning))
> - Anthropic Claude Extended → `thinking: { type: "enabled", budget_tokens: 4000 }` ([文档](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking))
> - DeepSeek-R1 → 自动推理，无需配置 ([文档](https://api-docs.deepseek.com/guides/reasoning_model))

```typescript
// === 标准模型：温度控制减少幻觉 ===
// 需要高准确性时（减少幻觉）
const llmConfigFactual = {
    temperature: 0.0,        // 最低温度，最确定性
    topP: 0.1,              // 限制采样范围
    frequencyPenalty: 0.5,   // 减少重复
};

// 需要创意时（接受一定幻觉风险）
const llmConfigCreative = {
    temperature: 0.8,
    topP: 0.9,
};

// === 推理模型：各家参数不同，但都不支持 temperature ===
// 推理模型本身幻觉率更低，适合高准确性场景
//
// OpenAI o1/o3: { model: "o3", reasoning_effort: "high" }
//   → https://platform.openai.com/docs/guides/reasoning
// Anthropic Claude Extended: { thinking: { type: "enabled", budget_tokens: 8000 } }
//   → https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
// DeepSeek-R1: { model: "deepseek-reasoner" }  // 自动推理
//   → https://api-docs.deepseek.com/guides/reasoning_model
```

### 3.5 约束解码（Constrained Decoding）

通过限制输出的格式/内容范围来减少幻觉：

```typescript
import { z } from "zod";

// 限制输出必须是可验证的事实声明
const FactClaimSchema = z.object({
    claim: z.string(),
    source: z.string().nullable(),     // 必须提供来源
    confidence: z.number().min(0).max(1),  // 0-1 置信度
    evidence: z.string().nullable(),
});

type FactClaim = z.infer<typeof FactClaimSchema>;

// 注意：outlines 是 Python 生态的约束解码库（pip install outlines），
// Node.js 生态目前没有直接等价物。以下为 outlines 原 Python 概念对比，
// 仅供参考，无法在 Node.js 直接运行：
//
// Python (outlines):
//   import outlines
//   model = outlines.models.transformers("meta-llama/Llama-3-8b")
//   generator = outlines.generate.json(model, FactClaim)
//   result = generator("北京的人口是多少？")
//
// 输出严格符合 FactClaim schema，减少幻觉
//
// Node.js 替代思路：
// - 使用 Zod schema + structured output（OpenAI API 的 response_format）
// - 使用 LangChain 的 withStructuredOutput() 方法
// - 使用 Anthropic 的 tool_use 进行结构化输出
```

### 3.6 不确定性表达

让模型学会说"我不知道"：

```markdown
## 系统指令
回答问题时请遵循以下规则：
1. 如果你确定答案，直接回答
2. 如果你不确定，明确说"我不确定，但根据我的了解..."
3. 如果完全不知道，直接说"抱歉，我没有这方面的可靠信息"
4. 永远不要编造事实来填补空白
```

## 4. 幻觉在各场景的应对策略

| 场景 | 幻觉风险 | 推荐策略 |
|------|----------|----------|
| 医疗咨询 | 极高 | RAG + 严格 Grounding + 免责声明 |
| 法律文档 | 极高 | 只做信息整理，不做法律建议 |
| 客服问答 | 高 | RAG + FAQ 知识库 + 转人工兜底 |
| 代码生成 | 中 | 幻觉也可能产生创意代码，需人工审查 |
| 内容创作 | 中低 | 创意类可接受一定幻觉，但事实类需验证 |
| 翻译 | 低 | 幻觉较少，主要关注忠实性 |
| 数学计算 | 中 | 用代码执行器而非 LLM 计算 |

## 5. 幻觉检测评估基准

| 基准 | 说明 | 类型 |
|------|------|------|
| [TruthfulQA](https://github.com/sylinrl/TruthfulQA) | 测试模型区分真假的能力 | 问答 |
| [HaluEval](https://github.com/RUCAIBox/HaluEval) | 中文幻觉评估 | 问答 |
| [FActScore](https://github.com/meta-llama/llama-models) | 人物传记事实性评估 | 生成 |
| [SelfCheckGPT](https://github.com/potsawee/selfcheckgpt) | 自我一致性检测 | 检测 |
| [HaluEval-Wild](https://github.com/THU-KEG/HaluEval-Wild) | 真实场景幻觉评估 | 检测 |

## 6. 推荐文章与资源

### 必读文章
- [A Survey on Hallucination in LLMs](https://arxiv.org/abs/2311.05232) — 幻觉综述论文
- [Siren's Song in the AI Ocean (Survey)](https://arxiv.org/abs/2309.01219) — 幻觉分类学
- [Chain-of-Verification (Meta)](https://arxiv.org/abs/2309.11495) — 验证链方法
- [RAG vs Hallucination](https://www.pinecone.io/learn/retrieval-augmented-generation/) — RAG 如何减少幻觉

### GitHub 仓库
- [awesome-llm-hallucination](https://github.com/LightChen233/awesome-hallucination-detection) — 幻觉检测资源大全
- [SelfCheckGPT](https://github.com/potsawee/selfcheckgpt) — 零资源幻觉检测
- [RAGAS](https://github.com/explodinggradients/ragas) — RAG 评估框架
- [Factool](https://github.com/GAIR-NLP/factool) — 多模态事实检测
- [LangCheck](https://github.com/citadel-ai/langcheck) — 多语言质量检查
