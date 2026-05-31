// 提问
import OpenAI from "openai";
import { search } from "../retriever/index.ts";
import type { QARequest, QAResponse, SearchResult } from "../types/types";

const deepseekApiKey = process.env.DEEPSEEK_API_KEY;

if (!deepseekApiKey) {
  throw new Error("未设置 DEEPSEEK_API_KEY，请在 .env 文件中配置 DeepSeek API Key");
}

const openai = new OpenAI({
  apiKey: deepseekApiKey,
  baseURL: "https://api.deepseek.com",
});

const RAG_PROMPT = `你是一个严谨、诚实的知识库助手。你的任务是基于提供的参考资料回答问题。

## 核心规则（必须遵守）
1. **只使用参考资料中的信息**来回答问题
2. 如果参考资料包含了足够的信息，请详细、准确地回答
3. 如果参考资料不足以回答问题，请明确说：
   "根据已有资料，我无法回答这个问题。"并解释资料中缺失了什么
4. **绝对不要编造**参考资料中没有的事实、数据或结论
5. 如果你使用了某条资料，请用 [来源：文件名] 的格式标注来源

## 回答要求
- 条理清晰，使用中文回答
- 可以分段、分点，但核心观点要突出
- 如果有多个参考资料涉及同一话题，尝试综合它们的信息
- 如果有矛盾之处，请指出并分别引用

## 参考资料
{context}

## 用户问题
{query}

## 你的回答（请严格遵守上述规则）`;

/**
 * 构建上下文——把检索到的文档块拼成 LLM 可读的格式
 * 为什么要格式化：把零散的块拼成统一结构的资料区，方便 LLM 解析和引用
 *
 * @param searchResults - 检索到的结果列表
 * @returns 格式化后的上下文字符串
 */
function buildContext(searchResults: SearchResult[]): string {
  if (searchResults.length === 0) {
    return "（没有找到相关的参考资料）";
  }

  // 为每个结果块添加编号和来源标注
  // 为什么加编号：[来源1]、[来源2] 比直接写文件名更简洁，LLM 引用也更自然
  return searchResults
    .map((result, index) => {
      const { source, page } = result.chunk.metadata;
      // 构建来源描述
      const sourceDesc = page ? `${source}（第${page}页）` : source;

      // 格式：[编号] 来源描述\n内容...
      // 为什么用 --开始/--结束：用醒目的分隔符告诉 LLM 这是一个独立的资料块
      return `\n--- 参考资料 [${index + 1}] 来自 ${sourceDesc} ---\n${result.chunk.content}\n--- 参考资料 [${index + 1}] 结束 ---\n`;
    })
    .join("\n");
}
/**
 * 构建完整的提示词
 * 为什么单独封装：可以在这里做 token 计数和截断，防止超出模型上下文限制
 *
 * @param query - 用户问题
 * @param context - 格式化后的上下文
 * @returns 完整的提示词字符串
 */
function buildPrompt(query: string, context: string): string {
  // 替换提示词模板中的占位符
  return RAG_PROMPT.replace("{context}", context).replace("{query}", query);
}
/**
 * 执行问答——完整流程：检索 → 组装提示词 → LLM 生成
 *
 * @param request - QA 请求
 * @returns QA 响应（包含答案、来源引用、检索结果）
 */
export async function askQuestion(request: QARequest): Promise<QAResponse> {
  const { query, maxResults = 5, scoreThreshold = 0.5 } = request;

  console.log(`\n📝 问题: ${query}\n`);

  // 步骤 1：检索相关文档块
  // 为什么先检索：先通过向量搜索缩小范围，大幅减少后续 LLM 处理的 token 量
  const searchResults = await search(query, { maxResults, scoreThreshold });

  // 步骤 2：构建上下文（将检索结果格式化为 LLM 可读的结构）
  const context = buildContext(searchResults);

  // 步骤 3：组装完整提示词
  const prompt = buildPrompt(query, context);

  // 步骤 4：调用 LLM 生成答案
  console.log(`  🤖 正在生成回答...`);

  try {
    const completion = await openai.chat.completions.create({
      model: "deepseek-v4-flash",

      // 消息：只有一条 user 消息，不用 system 消息
      // 为什么把角色定义和行为规则直接放在 user 消息里：
      //   1. system 消息在部分模型（非 OpenAI）中可能被忽略
      //   2. user 消息中的指令对大多数模型同样有效
      //   3. 单一消息更简单，调试时直观
      messages: [{ role: "user", content: prompt }],

      // max_tokens: 限制回答最大长度
      // 为什么设 1000：太短可能截断答案，太长浪费 token
      max_tokens: 1000,
    });

    // 提取回答内容
    const answerContent =
      completion.choices?.[0]?.message.content || "（模型未返回回答）";

    console.log(`  ✅ 回答生成完毕\n`);

    // 步骤 5：提取来源引用（提供给用户查看）
    const sources = searchResults.map((result) => {
      const source = {
        source: result.chunk.metadata.source,
        // 截取前 100 字作为预览
        snippet: result.chunk.content.substring(0, 100),
        score: result.score,
      };

      return result.chunk.metadata.page === undefined
        ? source
        : { ...source, page: result.chunk.metadata.page };
    });

    return {
      answer: answerContent,
      sources,
      searchResults,
    };
  } catch (error) {
    console.error(`  ❌ 生成回答失败: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * 获取提示词模板（供用户理解和学习用）
 * 为什么暴露：让用户看到完整的提示词，理解 RAG 是如何工作的
 */
export function getPromptTemplate(): string {
  return RAG_PROMPT;
}
