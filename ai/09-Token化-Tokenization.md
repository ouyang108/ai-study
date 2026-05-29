# Tokenization — Token 化与计算

## 1. 什么是 Tokenization

Tokenization（分词/标记化）是将原始文本转换为模型能理解的**最小语义单元(Token)**的过程。这是 LLM 管道的第一步，理解它才能做好**上下文管理、成本估算、Prompt 优化**。

```
文本: "我喜欢学习AI"  →  Tokenizer  →  [12345, 67890, 11111, 22222]
                                           "我"  "喜欢"  "学习" "AI"
```

## 2. 为什么必须理解 Token

| 原因 | 说明 |
|------|------|
| **成本计算** | API 按 Token 收费，不搞清楚就等着账单爆炸 |
| **上下文限制** | 模型有 Token 上限，写 Prompt 前得算清楚 |
| **性能优化** | 同样的意思，不同的表达方式 Token 数可能差几倍 |
| **调试排错** | 模型"看不懂"你的输入，可能是 Tokenizer 切错了 |

## 3. 主流 Tokenizer 对比

| Tokenizer | 所用模型 | 中文效率 | 特点 |
|-----------|----------|----------|------|
| **GPT Tokenizer (cl100k_base)** | GPT-4/GPT-3.5 | 1 汉字 ≈ 1.5-2 tokens | 中文较浪费 |
| **Claude Tokenizer** | Claude 系列 | 1 汉字 ≈ 1.2-1.5 tokens | 中文效率略好 |
| **Gemini Tokenizer** | Gemini 系列 | 1 汉字 ≈ 0.8-1.2 tokens | 中文效率最好 |
| **Qwen Tokenizer** | 通义千问 | 1 汉字 ≈ 0.6-1 token | 中文专项优化 |
| **DeepSeek Tokenizer** | DeepSeek | 1 汉字 ≈ 0.7-1 token | 中文效率高 |
| **Llama Tokenizer** | Llama 系列 | 1 汉字 ≈ 2-3 tokens | 中文效率最差 |

**关键结论**: 同样的中文内容，用 Llama tokenizer 可能比 Qwen 多消耗 3-5 倍的 token。如果你主要处理中文，选对模型本身就省了一大笔钱。

## 4. Token 计算实战

```typescript
// === 方法1: js-tiktoken (OpenAI 模型) ===
import { getEncoding, encodingForModel } from "js-tiktoken";

/**
 * 计算 OpenAI 模型的 token 数
 * @param text 要计算的文本
 * @param model 模型名称，默认 "gpt-4o"
 * @returns token 数量
 */
function countTokensOpenAI(text: string, model: string = "gpt-4o"): number {
  try {
    const encoding = encodingForModel(model);
    return encoding.encode(text).length;
  } catch {
    // 回退到 cl100k_base 编码
    const encoding = getEncoding("cl100k_base");
    return encoding.encode(text).length;
  }
}

// === 方法2: 粗略估算（不依赖库） ===

/**
 * 粗略估算 token 数
 * @param text 要估算的文本
 * @param language 语言类型，"zh" 为中文，其他为英文
 * @returns 估算的 token 数量
 */
function estimateTokensRough(text: string, language: string = "zh"): number {
  if (language === "zh") {
    // 中文: 1 个汉字 ≈ 0.7-1.5 tokens（取决于 tokenizer）
    // 偏保守估算，去除空格后按字符数计
    return text.replace(/\s/g, "").length;
  } else {
    // 英文: 1 token ≈ 4 字符 / 0.75 单词
    return Math.ceil(text.split(/\s+/).length * 1.3);
  }
}

// === 方法3: @xenova/transformers 库（开源模型） ===
// import { AutoTokenizer } from "@xenova/transformers";
//
// async function countTokensHuggingFace(text: string): Promise<void> {
//   const tokenizer = await AutoTokenizer.from_pretrained("Qwen/Qwen2.5-7B-Instruct");
//   const encoded = await tokenizer.encode(text);
//   console.log(`Tokens: ${encoded.length}, IDs: ${Array.from(encoded)}`);
//   // Tokens: 5, IDs: [104949, 99776, 99586, 100250, 101713]
// }
//
// // 使用示例
// // countTokensHuggingFace("今天天气真好");

// === 方法4: @anthropic-ai/tokenizer (Claude 模型) ===
// import { countTokens } from "@anthropic-ai/tokenizer";
//
// function countTokensClaude(text: string): number {
//   return countTokens(text);
// }
```

## 5. 不同语言的 Token 成本对比

```javascript
// 同样的意思，不同语言消耗的 token 差异很大
const testTexts = {
  "中文": "今天天气真好，适合出去散步。",
  "English": "The weather is great today, perfect for a walk.",
  "日本語": "今日は天気が良くて、散歩にぴったりです。",
};

// GPT-4 tokenizer 测试结果（cl100k_base）
/*
中文:   11 字符 → ~15 tokens (1.36 tokens/字)
English: 56 字符 → ~13 tokens (0.23 tokens/字)
日本語:   20 字符 → ~22 tokens (1.1 tokens/字)
*/

// 结论：英文最省 token，中日文消耗较大
// 如果做国际化产品，默认语言设英文能省不少钱

// === 实际计算示例 ===
// import { getEncoding } from "js-tiktoken";
//
// const enc = getEncoding("cl100k_base");
// for (const [lang, text] of Object.entries(testTexts)) {
//   const tokens = enc.encode(text);
//   console.log(`${lang}: ${text.length} 字符 → ${tokens.length} tokens`);
// }
```

## 6. Prompt 的 Token 构成

一个 API 调用消耗的 Token 包含：

```
总 Token 消耗 = Input Tokens + Output Tokens

Input Tokens (输入) 包括:
├── System Prompt（系统提示词）
├── User Messages（用户消息）
├── Assistant Messages（历史 AI 回复）
├── Tool Definitions（工具定义，如果有）
├── Tool Call Results（工具调用结果，如果有）
└── 格式开销（每条约 3-5 tokens 的元数据）

Output Tokens (输出) 包括:
├── 生成的文本内容
├── 工具调用参数（如果有）
└── 思维链内容（如果模型支持）

# 费用公式（以 GPT-4o 为例）
# Input:  $2.50 / 1M tokens
# Output: $10.00 / 1M tokens
# 总费用 = input_tokens/1M × $2.50 + output_tokens/1M × $10.00
```

## 7. Token 优化技巧

```typescript
// 技巧1: 用英文写 System Prompt（节省 30-50%）
// ❌ 中文 System Prompt: ~500 tokens
// ✅ 英文 System Prompt: ~200 tokens

// 技巧2: 删除不必要的空白符和格式
// ❌ 有很多空格和换行的 Prompt: ~300 tokens
// ✅ 紧凑格式: ~200 tokens

// 技巧3: 精简历史对话
// 不用全量历史，用摘要替代（见 08-上下文管理-Context-Management.md）

// 技巧4: 用缩写替代常用短语（在模型能理解的前提下）
// "Retrieval-Augmented Generation" → "RAG"（7 tokens → 1 token）

// 技巧5: 工具定义的 description 字段要精简
// ❌ 过长的 description: 100 tokens/工具 × 10个工具 = 1000 tokens
// ✅ 精简的 description: 30 tokens/工具 × 10个工具 = 300 tokens

// === 实用工具函数：估算 API 调用成本 ===
/**
 * 估算 OpenAI API 调用成本
 * @param inputTokens 输入 token 数
 * @param outputTokens 输出 token 数
 * @param inputPrice 输入价格（$/1M tokens），默认 GPT-4o: $2.50
 * @param outputPrice 输出价格（$/1M tokens），默认 GPT-4o: $10.00
 */
function estimateCost(
  inputTokens: number,
  outputTokens: number,
  inputPrice: number = 2.5,
  outputPrice: number = 10.0
): number {
  return (inputTokens / 1_000_000) * inputPrice + (outputTokens / 1_000_000) * outputPrice;
}

// 使用示例
// const cost = estimateCost(5000, 500);
// console.log(`预估费用: $${cost.toFixed(6)}`);

// === 实时统计工具：记录每次调用的 token 消耗 ===
class TokenUsageTracker {
  private totalInputTokens: number = 0;
  private totalOutputTokens: number = 0;
  private callCount: number = 0;

  /** 记录一次 API 调用 */
  track(inputTokens: number, outputTokens: number): void {
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
    this.callCount++;
  }

  /** 获取统计摘要 */
  getSummary(): { totalInput: number; totalOutput: number; calls: number; avgInput: number; avgOutput: number } {
    return {
      totalInput: this.totalInputTokens,
      totalOutput: this.totalOutputTokens,
      calls: this.callCount,
      avgInput: this.callCount > 0 ? Math.round(this.totalInputTokens / this.callCount) : 0,
      avgOutput: this.callCount > 0 ? Math.round(this.totalOutputTokens / this.callCount) : 0,
    };
  }

  /** 重置统计 */
  reset(): void {
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.callCount = 0;
  }
}

// 全局单例
// export const tokenTracker = new TokenUsageTracker();
```

## 8. Tokenizer Playground

推荐以下工具来可视化 Token 切分过程：
- [OpenAI Tokenizer](https://platform.openai.com/tokenizer)
- [Tiktokenizer](https://tiktokenizer.vercel.app/) — 可视化多模型对比
- [HuggingFace Tokenizer Playground](https://huggingface.co/spaces/Xenova/tokenizer-playground)

## 9. 推荐文章

- [OpenAI Tokenizer Guide](https://platform.openai.com/tokenizer)
- [HuggingFace Tokenizers 文档](https://huggingface.co/docs/transformers/tokenizer_summary)
- [Byte Pair Encoding 论文 (BPE原始论文)](https://arxiv.org/abs/1508.07909)
- [SentencePiece (Google)](https://github.com/google/sentencepiece)
