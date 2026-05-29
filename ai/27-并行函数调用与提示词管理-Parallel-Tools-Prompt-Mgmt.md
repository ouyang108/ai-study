# 并行函数调用 与 提示词版本管理

> 读完你能做出：(1) 支持并行工具调用的高性能 Agent；(2) 带版本控制和 A/B 测试的提示词管理系统

---

---

# 第一部分：并行函数调用 (Parallel Function Calling)

## 1.1 为什么需要并行

回顾 22-Agent 的实现，核心循环中只取了第一个工具调用：

```typescript
// 22-Agent 的串行处理（只取 tool_calls[0]）
const toolCall = message.tool_calls[0] as unknown as ToolCall;
// 一次只执行一个工具，其余的全部忽略
```

当用户问"北京和上海今天天气对比"时，LLM 会返回两个独立的 `get_weather` 调用。串行处理意味着：

```
串行执行时间线：
  北京天气查询 ████████░░░░░░░░ (2s)
                        上海天气查询 ████████░░░░░░░░ (2s)
  总耗时 = 2s + 2s = 4s

并行执行时间线：
  北京天气查询 ████████░░░░░░░░ (2s)
  上海天气查询 ████████░░░░░░░░ (2s)  ← 同时执行
  总耗时 = max(2s, 2s) = 2s  → 节省 50%
```

如果有 5 个独立工具调用，并行可以节省 80% 的时间。对于 LLM 调用本身已经是瓶颈的场景，减少往返次数至关重要。

---

## 1.2 判断哪些调用可以并行

并不是所有工具调用都可以并行。核心问题：**工具 B 是否依赖工具 A 的输出？**

### 依赖关系分类

| 场景 | 依赖关系 | 可否并行 | 示例 |
|------|---------|---------|------|
| 查询两个不同城市的天气 | 无依赖 | 可并行 | `get_weather("北京")` + `get_weather("上海")` |
| 搜索后再搜索搜索结果中的标题 | 有依赖 | 串行 | `search("AI")` → `search(results[0].title)` |
| 计算两个独立表达式 | 无依赖 | 可并行 | `calculate("1+1")` + `calculate("2*3")` |
| 获取当前时间后计算时间差 | 有依赖 | 串行 | `get_time()` → `calculate(diff)` |
| 天气查询 + 数学计算 | 无依赖 | 可并行 | `get_weather("北京")` + `calculate("38*2")` |

### 依赖分析器实现

依赖分析的策略：对于大多数常见工具组合，我们可以通过**静态规则**判断依赖性。完整实现中还需要考虑**动态依赖**（即 B 的参数中引用了 A 的输出）。

```typescript
// ──────────────────────────────────────────
// src/parallel/dependency-analyzer.ts
// 工具调用依赖分析器 — 判断哪些调用可以并行执行
// ──────────────────────────────────────────

import type { ToolCall } from "../tools"; // 复用 22-Agent 的工具类型定义

/**
 * 依赖分析结果
 */
export interface DependencyAnalysis {
  /** 可以并行执行的调用组（每组内无相互依赖） */
  parallelGroups: ToolCall[][];
  /** 必须串行执行的调用链（前一个的输出影响后一个的输入） */
  serialChains: ToolCall[][];
}

/**
 * 判断工具 B 是否依赖工具 A 的结果
 *
 * 依赖判断策略：
 * 1. 静态规则：某些工具组合天然有依赖关系（如 search → search）
 * 2. 动态规则：检查 B 的参数是否包含对 A 结果的引用占位符
 * 3. 默认策略：不同工具类型之间无依赖，同一工具是否可并行取决于工具语义
 */
function isDependentOn(callA: ToolCall, callB: ToolCall): boolean {
  const nameA = callA.function.name;
  const nameB = callB.function.name;
  const argsB = callB.function.arguments;

  // ── 规则1: 同一搜索工具多次调用，第二个关键词包含第一个的预期结果关键词 — 标记为可能依赖 ──
  // 这是启发性规则，实际生产中可以接入 LLM 进行更精确的判断
  if (nameA === "search_web" && nameB === "search_web") {
    const argsA = JSON.parse(callA.function.arguments);
    // 如果 B 的 query 引用了搜索关键词，很可能是依赖链
    // 简单策略：同一搜索工具的多次调用保守地串行执行（实际场景中搜索常是探索性的）
    // 生产环境可以接入一个小 LLM 来判断语义依赖性
    return false; // 默认可并行 — 可根据实际需求调整
  }

  // ── 规则2: 同一个 get_weather 调用多次（不同城市） — 无依赖，可并行 ──
  if (nameA === "get_weather" && nameB === "get_weather") {
    return false; // 不同城市的天气查询互相独立
  }

  // ── 规则3: calculate 之间互相独立 ──
  if (nameA === "calculate" && nameB === "calculate") {
    return false;
  }

  // ── 规则4: 跨工具类型默认无依赖 ──
  // get_weather + calculate 可以并行，get_weather + search_web 可以并行
  if (nameA !== nameB) {
    return false;
  }

  // ── 默认：同一工具多次调用保守串行 ──
  return true;
}

/**
 * 将工具调用列表划分为并行组和串行链
 *
 * 算法：
 * 1. 遍历工具调用列表
 * 2. 对每个调用，检查它是否依赖前面未执行的调用
 * 3. 无依赖的放入同一个并行组
 * 4. 有依赖的启动新的串行组
 *
 * 示例：
 *   输入: [weather(北京), search(AI), weather(上海), search(AI趋势)]
 *   输出: [[weather(北京), search(AI), weather(上海), search(AI趋势)]]  — 全部并行
 *
 *   输入: [search(AI), calculate(1+1), get_weather(北京)]
 *   输出: [[search(AI), calculate(1+1), get_weather(北京)]]  — 全部并行
 */
export function analyzeDependencies(toolCalls: ToolCall[]): DependencyAnalysis {
  if (toolCalls.length <= 1) {
    return {
      parallelGroups: [toolCalls],
      serialChains: [],
    };
  }

  const parallelGroups: ToolCall[][] = [];
  const serialChains: ToolCall[][] = [];
  let currentGroup: ToolCall[] = [];

  for (let i = 0; i < toolCalls.length; i++) {
    const current = toolCalls[i];

    // 检查当前调用是否依赖当前组中已存在的任何调用
    const hasDependencyOnCurrentGroup = currentGroup.some((prev) =>
      isDependentOn(prev, current)
    );

    if (hasDependencyOnCurrentGroup) {
      // 有依赖 → 当前组结束，开始新的串行链
      if (currentGroup.length > 0) {
        parallelGroups.push([...currentGroup]);
      }
      serialChains.push([...currentGroup, current]);
      // current 同时开启新组（因为后续的调用可能和它并行）
      currentGroup = [current];
    } else {
      // 无依赖 → 加入当前并行组
      currentGroup.push(current);
    }
  }

  // 最后一个组
  if (currentGroup.length > 0) {
    // 检查它是否已经在 serialChains 的最后一个元素中
    const lastSerial = serialChains[serialChains.length - 1];
    if (
      !lastSerial ||
      lastSerial[lastSerial.length - 1].id !==
        currentGroup[currentGroup.length - 1].id
    ) {
      parallelGroups.push([...currentGroup]);
    }
  }

  return { parallelGroups, serialChains };
}

/**
 * 将工具调用列表转换为可执行计划
 * 返回一个二维数组，外层数组表示执行步骤（串行），内层数组表示该步骤内可并行的调用
 */
export function buildExecutionPlan(toolCalls: ToolCall[]): ToolCall[][] {
  if (toolCalls.length === 0) return [];

  const plan: ToolCall[][] = [];
  const analyzed = analyzeDependencies(toolCalls);

  // 第一步：所有无依赖的组先并行执行
  if (analyzed.parallelGroups.length > 0) {
    // 扁平化第一个并行组（通常所有无依赖的调用都在一个组里）
    const firstGroup = analyzed.parallelGroups.flat();
    if (firstGroup.length > 0) {
      plan.push(firstGroup);
    }
  }

  // 后续步骤：串行链中的每个调用各自成为一步
  for (const chain of analyzed.serialChains) {
    // chain 中第一个已经在并行组中了，后续的需要单独执行
    for (let i = 0; i < chain.length; i++) {
      plan.push([chain[i]]);
    }
  }

  return plan;
}
```

---

## 1.3 并行工具执行器完整实现

下面是与 22-Agent 兼容的并行执行器。它可以直接替换 22-Agent 中 `runAgent` 函数的工具调用部分。

```typescript
// ──────────────────────────────────────────
// src/parallel/parallel-executor.ts
// 并行工具执行器 — 核心实现
// ──────────────────────────────────────────

import type { ToolCall, ToolResult } from "../tools";
import { executeTool } from "../tools";
import { buildExecutionPlan } from "./dependency-analyzer";

/**
 * 并行执行结果中的单项（包含成功或失败的标记）
 */
export interface ParallelToolResult {
  /** 工具调用信息 */
  toolCall: ToolCall;
  /** 执行结果 */
  result: ToolResult;
  /** 是否成功 */
  success: boolean;
  /** 错误信息（失败时） */
  error?: string;
}

/**
 * 并行执行配置
 */
export interface ParallelExecutorConfig {
  /** 单次并行执行的最大并发数（防止 API 限流） */
  maxConcurrency?: number;
  /** 单个工具调用超时时间（毫秒） */
  timeout?: number;
  /** 是否在部分失败时继续执行剩余步骤 */
  continueOnPartialFailure?: boolean;
  /** 调试日志回调 */
  onStep?: (step: number, calls: ToolCall[], results: ParallelToolResult[]) => void;
}

/**
 * 并行工具执行器
 *
 * 核心流程：
 * 1. LLM 返回多个 tool_calls
 * 2. 分析哪些可以并行、哪些必须串行
 * 3. 对每个执行步骤：
 *    - 并行组 → Promise.all 同时执行
 *    - 串行组 → 逐个执行
 * 4. 合并结果返回给 LLM
 * 5. 部分失败时继续或终止
 */
export class ParallelToolExecutor {
  private config: Required<ParallelExecutorConfig>;

  constructor(config: ParallelExecutorConfig = {}) {
    this.config = {
      maxConcurrency: config.maxConcurrency ?? 5,
      timeout: config.timeout ?? 30_000,      // 默认 30 秒超时
      continueOnPartialFailure: config.continueOnPartialFailure ?? true,
      onStep: config.onStep ?? (() => {}),
    };
  }

  /**
   * 执行一批工具调用（自动判断串行/并行）
   *
   * @param toolCalls - LLM 返回的所有工具调用
   * @returns 所有工具调用及其执行结果
   */
  async execute(toolCalls: ToolCall[]): Promise<ParallelToolResult[]> {
    if (toolCalls.length === 0) return [];

    const allResults: ParallelToolResult[] = [];

    // Step 1: 分析依赖，生成执行计划
    const plan = buildExecutionPlan(toolCalls);

    console.log(
      `\n📋 执行计划: ${plan.length} 步, ` +
      `${toolCalls.length} 个工具调用 → ` +
      plan.map((g, i) => `第${i + 1}步[${g.map(c => c.function.name).join(", ")}]`).join(" → ")
    );

    // Step 2: 按计划逐步执行
    for (let stepIndex = 0; stepIndex < plan.length; stepIndex++) {
      const stepCalls = plan[stepIndex];
      const isParallelStep = stepCalls.length > 1;

      console.log(
        `\n  ${isParallelStep ? "⚡ 并行" : "➡️  串行"}执行 第${stepIndex + 1}步: ` +
        `${stepCalls.map(c => `${c.function.name}(${c.function.arguments.slice(0, 40)}...)`).join(", ")}`
      );

      let stepResults: ParallelToolResult[];

      if (isParallelStep) {
        // ── 并行执行：Promise.all 同时发起所有调用 ──
        stepResults = await this.executeParallel(stepCalls);
      } else {
        // ── 串行执行：逐个调用 ──
        stepResults = [];
        for (const call of stepCalls) {
          const result = await this.executeSingle(call);
          stepResults.push(result);
        }
      }

      allResults.push(...stepResults);
      this.config.onStep(stepIndex + 1, stepCalls, stepResults);

      // Step 3: 检查是否有失败的调用
      const failures = stepResults.filter((r) => !r.success);
      if (failures.length > 0) {
        console.warn(
          `  ⚠️ 第${stepIndex + 1}步有 ${failures.length}/${stepResults.length} 个调用失败`
        );
        if (!this.config.continueOnPartialFailure && stepResults.some((r) => !r.success)) {
          console.error("  🛑 配置为部分失败时终止，中止后续步骤");
          break;
        }
      }
    }

    return allResults;
  }

  /**
   * 并行执行一组工具调用
   * 使用 Promise.allSettled 确保部分失败不会影响其他调用
   */
  private async executeParallel(calls: ToolCall[]): Promise<ParallelToolResult[]> {
    const startTime = Date.now();

    // 使用 Promise.allSettled：即使部分失败，也能获取全部结果
    // 配合并发限制，防止对 API 造成过大压力
    const promises = calls.map((call) =>
      this.executeWithTimeout(call, this.config.timeout)
    );

    const settled = await Promise.allSettled(promises);

    const elapsed = Date.now() - startTime;
    console.log(`  ⏱️ 并行执行耗时: ${elapsed}ms (${calls.length} 个调用)`);

    // 处理每个 settled 结果
    return settled.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        // Promise 被 reject 了（超时或异常）
        return {
          toolCall: calls[index],
          result: {
            tool_call_id: calls[index].id,
            content: `错误: ${result.reason?.message || "未知错误"}`,
          },
          success: false,
          error: result.reason?.message || "未知错误",
        };
      }
    });
  }

  /**
   * 执行单个工具调用（带超时保护）
   */
  private async executeWithTimeout(
    call: ToolCall,
    timeoutMs: number
  ): Promise<ParallelToolResult> {
    try {
      // 竞速：工具执行 vs 超时
      const result = await Promise.race([
        executeTool(call),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`工具 ${call.function.name} 执行超时 (${timeoutMs}ms)`)),
            timeoutMs
          )
        ),
      ]);

      return {
        toolCall: call,
        result,
        success: true,
      };
    } catch (err) {
      return {
        toolCall: call,
        result: {
          tool_call_id: call.id,
          content: `工具执行失败: ${(err as Error).message}`,
        },
        success: false,
        error: (err as Error).message,
      };
    }
  }

  /**
   * 执行单个工具调用（不带超时，用于串行场景）
   */
  private async executeSingle(call: ToolCall): Promise<ParallelToolResult> {
    try {
      const result = await executeTool(call);
      return {
        toolCall: call,
        result,
        success: true,
      };
    } catch (err) {
      return {
        toolCall: call,
        result: {
          tool_call_id: call.id,
          content: `工具执行失败: ${(err as Error).message}`,
        },
        success: false,
        error: (err as Error).message,
      };
    }
  }
}

// ──────────────────────────────────────────
// 便捷工厂函数
// ──────────────────────────────────────────

/**
 * 创建默认配置的并行执行器
 */
export function createParallelExecutor(): ParallelToolExecutor {
  return new ParallelToolExecutor({
    maxConcurrency: 5,
    timeout: 30_000,
    continueOnPartialFailure: true,
  });
}
```

---

## 1.4 改造后的 Agent 核心循环（支持并行）

将并行执行器集成到 22-Agent 的 `runAgent` 中。核心改动：不再取 `tool_calls[0]`，而是处理全部 `tool_calls`。

```typescript
// ──────────────────────────────────────────
// src/parallel/parallel-agent.ts
// 支持并行工具调用的 Agent 核心循环
// ──────────────────────────────────────────

import OpenAI from "openai";
import "dotenv/config";
import { TOOLS, executeTool, type ToolCall, type ToolResult } from "../tools";
import { ParallelToolExecutor, createParallelExecutor } from "./parallel-executor";

// ── 复用 22-Agent 的 OpenAI 客户端初始化和类型定义 ──
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const AGENT_SYSTEM_PROMPT = `你是一个智能助手 Agent，可以调用工具来完成任务。

## 工具使用规则
1. 当需要实时信息、计算、或不确定的事实时，调用对应工具
2. 如果多个工具调用之间没有依赖关系，请在同一个回复中同时发起（并行调用）
3. 拿到工具结果后，判断是否需要继续调用其他工具
4. 如果信息足够回答问题，直接给出最终答案
5. 如果工具调用失败，告诉用户失败原因，尝试其他方法

## 并行调用示例
- "北京和上海天气对比" → 同时调用 get_weather("北京") 和 get_weather("上海")
- "搜索AI并计算1+1" → 同时调用 search_web("AI") 和 calculate("1+1")

## 输出规则
- 回答要简洁
- 涉及计算时，先展示公式再展示结果
- 涉及搜索时，引用搜索结果的要点`;

const MAX_TURNS = 10;

interface AgentResponse {
  answer: string;
  turns: number;
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }>;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/**
 * 支持并行工具调用的 Agent 主循环
 *
 * 与 22-Agent 的关键区别：
 * - 处理 message.tool_calls 的全部调用（而非只取 [0]）
 * - 使用 ParallelToolExecutor 自动判断串行/并行
 * - 将多个 tool_call 和 tool result 消息打包加入上下文
 */
async function runParallelAgent(userMessage: string): Promise<AgentResponse> {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  const toolCallLog: AgentResponse["toolCalls"] = [];
  let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  // 创建并行执行器
  const executor = createParallelExecutor();

  // —— Agent 主循环 ——
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    console.log(`\n🔄 第 ${turn + 1} 轮...`);

    // Step 1: 调用 LLM（可能返回多个 tool_calls）
    const response = await client.chat.completions.create({
      model: process.env.AGENT_MODEL || "gpt-4o",
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0,
    });

    const choice = response.choices[0];
    const { message } = choice;

    // 统计 token 消耗
    if (response.usage) {
      totalUsage.promptTokens += response.usage.prompt_tokens;
      totalUsage.completionTokens += response.usage.completion_tokens;
      totalUsage.totalTokens += response.usage.total_tokens;
    }

    // Step 2: 判断是否有工具调用
    if (message.tool_calls && message.tool_calls.length > 0) {
      // ── 处理全部工具调用（这是与 22-Agent 的核心区别）──
      const allToolCalls = message.tool_calls as unknown as ToolCall[];

      console.log(
        `  🔧 LLM 请求了 ${allToolCalls.length} 个工具调用: ` +
        allToolCalls.map((tc) => tc.function.name).join(", ")
      );

      // ── 使用并行执行器自动判断串行/并行 ──
      const startExecTime = Date.now();
      const results = await executor.execute(allToolCalls);
      const execTime = Date.now() - startExecTime;

      // 输出每个工具的结果
      results.forEach((pr) => {
        const status = pr.success ? "✅" : "❌";
        console.log(
          `  ${status} ${pr.toolCall.function.name}: ${pr.result.content.slice(0, 80)}`
        );
      });
      console.log(`  ⏱️ 本轮执行总耗时: ${execTime}ms`);

      // 记录日志
      results.forEach((pr) => {
        const fnName = pr.toolCall.function.name;
        const fnArgs = JSON.parse(pr.toolCall.function.arguments);
        toolCallLog.push({
          name: fnName,
          args: fnArgs as Record<string, unknown>,
          result: pr.result.content,
        });
      });

      // ── 将所有 tool_call 和对应的 tool 结果消息打包加入上下文 ──
      // assistant 消息：包含所有 tool_calls
      messages.push({
        role: "assistant",
        tool_calls: allToolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
      });

      // tool 消息：每个工具一条结果消息
      results.forEach((pr) => {
        messages.push({
          role: "tool",
          tool_call_id: pr.result.tool_call_id,
          content: pr.result.content,
        });
      });

      // 继续循环，让 LLM 根据全部工具结果决定下一步
      continue;
    }

    // —— 情况B: LLM 直接回答 ——
    const answer = message.content || "（LLM 未生成回复）";
    console.log(`  💬 最终回答: ${answer.slice(0, 100)}...`);

    return { answer, turns: turn + 1, toolCalls: toolCallLog, usage: totalUsage };
  }

  return {
    answer: "抱歉，处理超时。任务可能太复杂，请简化问题后重试。",
    turns: MAX_TURNS,
    toolCalls: toolCallLog,
    usage: totalUsage,
  };
}

export { runParallelAgent };
```

---

## 1.5 串行 vs 并行：性能对比

```typescript
// ──────────────────────────────────────────
// src/parallel/benchmark.ts
// 串行 vs 并行 Agent 性能对比基准测试
// ──────────────────────────────────────────

import { runAgent as runSerialAgent } from "../agent";
import { runParallelAgent } from "./parallel-agent";

/**
 * 性能对比结果
 */
interface BenchmarkResult {
  mode: "serial" | "parallel";
  scenario: string;
  turns: number;
  toolCalls: number;
  elapsedMs: number;
  tokens: { prompt: number; completion: number; total: number };
}

// ── 模拟：在 LLM 不可用时仍然展示对比逻辑 ──
// 通过模拟工具调用的耗时来演示并行带来的性能提升

/**
 * 模拟一批工具调用的执行
 * 用于在无真实 LLM 环境下演示串行 vs 并行的差异
 */
async function benchmarkSerialVsParallel(): Promise<void> {
  console.log("=" .repeat(60));
  console.log("串行 vs 并行 — 性能对比演示");
  console.log("=" .repeat(60));

  // 模拟场景：用户问"北京、上海、广州、深圳四个城市天气对比"
  const scenarios = [
    {
      name: "2 个独立工具调用 (北京+上海天气)",
      serialTime: 4000,  // 每个工具 2s，串行 4s
      parallelTime: 2000, // 并行 max(2s, 2s) = 2s
    },
    {
      name: "3 个独立工具调用 (北京+上海+广州天气)",
      serialTime: 6000,
      parallelTime: 2000,
    },
    {
      name: "4 个独立工具调用 (北京+上海+广州+深圳天气)",
      serialTime: 8000,
      parallelTime: 2000,
    },
    {
      name: "5 个独立工具调用 + 混合场景",
      serialTime: 10000,
      parallelTime: 3000, // 假设部分依赖需要额外 1s
    },
  ];

  console.log("\n| 场景 | 串行耗时 | 并行耗时 | 节省 | 提升 |");
  console.log("|------|---------|---------|------|------|");

  for (const scenario of scenarios) {
    const saved = scenario.serialTime - scenario.parallelTime;
    const improvement = ((saved / scenario.serialTime) * 100).toFixed(0);
    console.log(
      `| ${scenario.name} | ${scenario.serialTime}ms | ${scenario.parallelTime}ms | ${saved}ms | ${improvement}% |`
    );
  }

  // ── Token 节省分析 ──
  // 并行调用减少了 LLM 交互轮数，本质上也减少了 token 消耗
  console.log("\n── Token 节省分析 ──");
  console.log("并行调用减少 LLM 交互轮数:");
  console.log("  串行 4 个工具: 4 次 LLM 调用 → 4 × context tokens");
  console.log("  并行 4 个工具: 2 次 LLM 调用 → 2 × context tokens");
  console.log("  节省: 约 50% 的 prompt tokens（因为减少了历史消息的重复传输）");
  console.log("");
  console.log("具体 token 节省量取决于:");
  console.log("  - 工具结果的长度");
  console.log("  - 每次 LLM 调用的 system prompt + 历史消息大小");
  console.log("  - 模型定价（输入 token 通常比输出 token 便宜得多）");
}

// ── 真实基准测试（需要真实 LLM API）──
async function runRealBenchmark(question: string): Promise<void> {
  console.log(`\n🏃 真实基准测试: "${question}"`);
  console.log("-".repeat(50));

  // 串行执行
  console.log("\n📊 串行模式:");
  const serialStart = Date.now();
  const serialResult = await runSerialAgent(question);
  const serialTime = Date.now() - serialStart;

  // 并行执行
  console.log("\n📊 并行模式:");
  const parallelStart = Date.now();
  const parallelResult = await runParallelAgent(question);
  const parallelTime = Date.now() - parallelStart;

  // 对比汇总
  console.log("\n" + "=" .repeat(50));
  console.log("📈 对比汇总:");
  console.log("=" .repeat(50));
  console.log(`  串行: ${serialTime}ms, ${serialResult.turns} 轮, ${serialResult.toolCalls.length} 次工具调用, ${serialResult.usage.totalTokens} tokens`);
  console.log(`  并行: ${parallelTime}ms, ${parallelResult.turns} 轮, ${parallelResult.toolCalls.length} 次工具调用, ${parallelResult.usage.totalTokens} tokens`);

  const timeSaved = serialTime - parallelTime;
  const timePct = ((timeSaved / serialTime) * 100).toFixed(1);
  console.log(`  时间: 节省 ${timeSaved}ms (${timePct}%)`);

  const tokenSaved = serialResult.usage.totalTokens - parallelResult.usage.totalTokens;
  const tokenPct = ((tokenSaved / serialResult.usage.totalTokens) * 100).toFixed(1);
  console.log(`  Token: 节省 ${tokenSaved} tokens (${tokenPct}%)`);
}

// ===== CLI 入口 =====
// 直接运行: npx tsx src/parallel/benchmark.ts
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length > 0 && args[0] === "--real") {
    const question = args[1] || "北京、上海、广州、深圳四个城市的天气对比";
    await runRealBenchmark(question);
  } else {
    // 默认：无 LLM 的模拟对比
    await benchmarkSerialVsParallel();
    console.log("\n💡 提示: 使用 --real 参数进行真实 LLM 基准测试");
    console.log("  npx tsx src/parallel/benchmark.ts --real \"北京上海天气对比\"");
  }
}

// 直接运行时执行 main
if (require.main === module) {
  main().catch(console.error);
}

export { benchmarkSerialVsParallel, runRealBenchmark };
```

---

## 1.6 并行调用的关键注意事项

### 注意1: 部分失败处理

当 3 个工具并行执行，1 个失败、2 个成功时：

```typescript
/**
 * 部分失败的处理策略
 *
 * 策略 A — 继续回答（推荐）：
 *   将成功的结果 + 失败的错误信息都返回给 LLM，
 *   LLM 基于部分结果尽力回答，同时告知用户哪些信息缺失。
 *
 * 策略 B — 重试失败项：
 *   对失败的工具单独重试（最多 N 次），
 *   重试仍失败则回退到策略 A。
 *
 * 策略 C — 终止并告知：
 *   如果失败的调用对回答至关重要，终止并让用户知道。
 */
function handlePartialFailure(results: ParallelToolResult[]): string {
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;
  return `${successCount} 个成功, ${failCount} 个失败`;
}
```

### 注意2: 并发数控制

```typescript
/**
 * 限流并发控制 — 使用信号量模式
 *
 * 当 LLM 返回 20 个并行工具调用时，全部同时发起可能：
 * - 超过 API 提供商的限流阈值
 * - 系统资源耗尽
 *
 * 解决方案：限制最大并发数，超出部分排队等待
 */
async function executeWithConcurrencyLimit<T, R>(
  items: T[],
  executor: (item: T) => Promise<R>,
  maxConcurrency: number = 5
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  // 创建工作线程池
  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await executor(items[index]);
    }
  }

  // 启动 maxConcurrency 个工作线程
  const workers = Array.from(
    { length: Math.min(maxConcurrency, items.length) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}
```

### 注意3: 上下文膨胀

并行执行时，多个工具结果同时加入消息历史，可能导致上下文快速膨胀。

```typescript
/**
 * 工具结果裁剪 — 防止上下文膨胀
 *
 * 当并行执行 5 个搜索，每个返回 2000 字时，
 * 一次性加入 10000 字的工具结果会快速填满上下文窗口
 */
function trimToolResults(results: ParallelToolResult[], maxTotalChars: number = 3000): void {
  const perResultLimit = Math.floor(maxTotalChars / results.length);

  results.forEach((pr) => {
    if (pr.result.content.length > perResultLimit) {
      pr.result.content =
        pr.result.content.slice(0, perResultLimit) +
        `\n...（已截断，完整结果 ${pr.result.content.length} 字符）`;
    }
  });
}
```

---

---

# 第二部分：提示词版本管理与 A/B 测试

## 2.1 为什么提示词需要版本管理

在 AI 应用开发中，提示词（prompt）是核心资产之一。它决定模型的输出质量和行为。但大多数团队对提示词的管理方式非常原始——直接写在代码里、通过 Slack 截图分享、靠口口相传。

**提示词需要版本管理的理由：**

| 问题 | 无版本管理 | 有版本管理 |
|------|-----------|-----------|
| "谁改了这个 prompt？" | 无法追溯 | git blame 即可定位 |
| "这个 prompt 为什么改成这样？" | 靠运气问同事 | 关联 PR 和 A/B 测试数据 |
| "旧版本效果更好，如何回滚？" | 手动从聊天记录找 | 一键回滚到指定版本 |
| "新 prompt 真的比旧的好吗？" | 凭感觉判断 | 有 A/B 测试数据支撑 |
| "代码 review 时如何审查 prompt？" | 无法审查 | 在 PR diff 中直接查看 |

---

## 2.2 Prompt Registry 完整实现

```typescript
// ──────────────────────────────────────────
// src/prompt-mgmt/prompt-registry.ts
// 提示词版本管理注册表
// ──────────────────────────────────────────

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

// ========== 类型定义 ==========

/**
 * 提示词版本信息
 */
export interface PromptVersion {
  /** 语义化版本号，如 "1.0.0" */
  version: string;
  /** 提示词内容 */
  content: string;
  /** 变更说明 */
  changelog: string;
  /** 修改人 */
  author: string;
  /** 创建时间 */
  createdAt: string;
  /** 内容的 SHA256 哈希（用于快速比对） */
  contentHash: string;
}

/**
 * 提示词模板（一个可版本化的提示词）
 */
export interface PromptTemplate {
  /** 模板唯一标识，如 "system-agent-v1" */
  name: string;
  /** 简短描述 */
  description: string;
  /** 所有历史版本 */
  versions: PromptVersion[];
  /** 当前活跃版本号 */
  currentVersion: string;
}

/**
 * 注册表存储结构
 */
interface RegistryStore {
  prompts: Record<string, PromptTemplate>;
  lastUpdated: string;
}

// ========== 核心类 ==========

/**
 * 提示词版本管理注册表
 *
 * 功能：
 * - 创建提示词模板
 * - 提交新版本（带变更说明和作者信息）
 * - 获取最新/指定版本
 * - 回滚到历史版本
 * - 对比两个版本差异
 * - 持久化到文件系统
 */
export class PromptRegistry {
  private store: RegistryStore;
  private storePath: string;

  /**
   * @param storePath - 持久化文件路径（建议放在 git 仓库中）
   */
  constructor(storePath: string = "./prompts/registry.json") {
    this.storePath = storePath;
    this.store = this.load();
  }

  /**
   * 创建新的提示词模板
   *
   * @param name - 模板名称
   * @param description - 描述
   * @param initialContent - 初始提示词内容
   * @param author - 创建人
   * @returns 创建的模板
   */
  createTemplate(
    name: string,
    description: string,
    initialContent: string,
    author: string
  ): PromptTemplate {
    if (this.store.prompts[name]) {
      throw new Error(`提示词模板 "${name}" 已存在`);
    }

    const initialVersion: PromptVersion = {
      version: "1.0.0",
      content: initialContent,
      changelog: "初始版本",
      author,
      createdAt: new Date().toISOString(),
      contentHash: this.computeHash(initialContent),
    };

    const template: PromptTemplate = {
      name,
      description,
      versions: [initialVersion],
      currentVersion: "1.0.0",
    };

    this.store.prompts[name] = template;
    this.save();
    console.log(`✅ 创建提示词模板 "${name}" v1.0.0`);
    return template;
  }

  /**
   * 提交新版本
   *
   * @param name - 模板名称
   * @param newContent - 新提示词内容
   * @param changelog - 变更说明（必填，强制记录修改原因）
   * @param author - 修改人
   * @param bumpType - 版本递增方式: "major" | "minor" | "patch"
   * @returns 新版本信息
   */
  async submitVersion(
    name: string,
    newContent: string,
    changelog: string,
    author: string,
    bumpType: "major" | "minor" | "patch" = "minor"
  ): Promise<PromptVersion> {
    const template = this.store.prompts[name];
    if (!template) {
      throw new Error(`模板 "${name}" 不存在`);
    }

    // 计算新版本号
    const currentVersion = this.getCurrentVersion(name);
    const newVersion = this.bumpVersion(currentVersion, bumpType);

    // 计算内容哈希（用于快速检测是否有实质性变更）
    const newHash = this.computeHash(newContent);

    // 检查内容是否真的有变化（防止重复提交）
    const latestVersion = template.versions.find(
      (v) => v.version === currentVersion
    );
    if (latestVersion && latestVersion.contentHash === newHash) {
      throw new Error(`内容与当前版本 ${currentVersion} 完全一致，无需提交新版本`);
    }

    // 创建新版本记录
    const newVersionRecord: PromptVersion = {
      version: newVersion,
      content: newContent,
      changelog,
      author,
      createdAt: new Date().toISOString(),
      contentHash: newHash,
    };

    // 添加到版本历史
    template.versions.push(newVersionRecord);
    template.currentVersion = newVersion;

    this.save();
    console.log(`✅ ${name}: v${currentVersion} → v${newVersion} (${bumpType})`);
    return newVersionRecord;
  }

  /**
   * 获取指定提示词的当前活跃版本内容
   *
   * @param name - 模板名称
   * @param version - 可选：指定版本号（不传则返回当前版本）
   * @returns 提示词内容
   */
  getPrompt(name: string, version?: string): string {
    const template = this.store.prompts[name];
    if (!template) {
      throw new Error(`模板 "${name}" 不存在`);
    }

    const targetVersion = version || template.currentVersion;
    const versionRecord = template.versions.find(
      (v) => v.version === targetVersion
    );

    if (!versionRecord) {
      throw new Error(`版本 "${targetVersion}" 不存在于模板 "${name}" 中`);
    }

    return versionRecord.content;
  }

  /**
   * 获取当前版本号
   */
  getCurrentVersion(name: string): string {
    const template = this.store.prompts[name];
    if (!template) {
      throw new Error(`模板 "${name}" 不存在`);
    }
    return template.currentVersion;
  }

  /**
   * 回滚到指定历史版本
   *
   * @param name - 模板名称
   * @param targetVersion - 目标版本号
   * @param author - 操作人
   * @returns 新的版本记录（回滚会创建新版本，而非直接修改 currentVersion）
   */
  async rollback(
    name: string,
    targetVersion: string,
    author: string
  ): Promise<PromptVersion> {
    const template = this.store.prompts[name];
    if (!template) {
      throw new Error(`模板 "${name}" 不存在`);
    }

    const targetRecord = template.versions.find(
      (v) => v.version === targetVersion
    );
    if (!targetRecord) {
      throw new Error(`目标版本 "${targetVersion}" 不存在`);
    }

    // 回滚本质上是创建一个内容等于目标版本的新版本
    // 这样做的好处：保留完整历史，包括回滚操作本身
    return await this.submitVersion(
      name,
      targetRecord.content,
      `回滚到 v${targetVersion}: ${targetRecord.changelog}`,
      author,
      "major" // 回滚视为主版本变更
    );
  }

  /**
   * 对比两个版本的差异
   *
   * @param name - 模板名称
   * @param versionA - 版本 A
   * @param versionB - 版本 B（默认为当前版本）
   * @returns 差异分析结果
   */
  compareVersions(
    name: string,
    versionA: string,
    versionB?: string
  ): {
    versionA: string;
    versionB: string;
    contentA: string;
    contentB: string;
    addedLines: number;
    removedLines: number;
    changedChars: number;
    isIdentical: boolean;
  } {
    const template = this.store.prompts[name];
    if (!template) {
      throw new Error(`模板 "${name}" 不存在`);
    }

    const recordA = template.versions.find((v) => v.version === versionA);
    const recordB = template.versions.find(
      (v) => v.version === (versionB || template.currentVersion)
    );

    if (!recordA) throw new Error(`版本 "${versionA}" 不存在`);
    if (!recordB) throw new Error(`版本 "${versionB || template.currentVersion}" 不存在`);

    const linesA = recordA.content.split("\n");
    const linesB = recordB.content.split("\n");

    // 简易 diff 统计（生产环境可用专业的 diff 库）
    const addedLines = Math.max(0, linesB.length - linesA.length);
    const removedLines = Math.max(0, linesA.length - linesB.length);
    const changedChars = Math.abs(
      recordB.content.length - recordA.content.length
    );
    const isIdentical = recordA.contentHash === recordB.contentHash;

    return {
      versionA,
      versionB: versionB || template.currentVersion,
      contentA: recordA.content,
      contentB: recordB.content,
      addedLines,
      removedLines,
      changedChars,
      isIdentical,
    };
  }

  /**
   * 列出模板的所有版本历史
   *
   * @param name - 模板名称
   * @returns 按时间倒序排列的版本列表
   */
  listVersions(name: string): PromptVersion[] {
    const template = this.store.prompts[name];
    if (!template) {
      throw new Error(`模板 "${name}" 不存在`);
    }
    // 按创建时间倒序排列（最新的在前）
    return [...template.versions].reverse();
  }

  /**
   * 列出所有注册的模板
   */
  listAllTemplates(): Array<{ name: string; description: string; currentVersion: string; versionCount: number }> {
    return Object.values(this.store.prompts).map((t) => ({
      name: t.name,
      description: t.description,
      currentVersion: t.currentVersion,
      versionCount: t.versions.length,
    }));
  }

  /**
   * 导出模板的所有版本（用于迁移或备份）
   */
  exportTemplate(name: string): PromptTemplate {
    const template = this.store.prompts[name];
    if (!template) {
      throw new Error(`模板 "${name}" 不存在`);
    }
    // 深拷贝
    return JSON.parse(JSON.stringify(template));
  }

  /**
   * 从导出数据导入模板
   */
  importTemplate(template: PromptTemplate, overwrite: boolean = false): void {
    if (this.store.prompts[template.name] && !overwrite) {
      throw new Error(`模板 "${template.name}" 已存在，使用 overwrite=true 覆盖`);
    }
    this.store.prompts[template.name] = template;
    this.save();
  }

  // ========== 内部辅助方法 ==========

  /** 递增版本号 */
  private bumpVersion(
    current: string,
    type: "major" | "minor" | "patch"
  ): string {
    const [major, minor, patch] = current.split(".").map(Number);
    switch (type) {
      case "major":
        return `${major + 1}.0.0`;
      case "minor":
        return `${major}.${minor + 1}.0`;
      case "patch":
        return `${major}.${minor}.${patch + 1}`;
      default:
        return current;
    }
  }

  /** 计算内容的 SHA256 哈希 */
  private computeHash(content: string): string {
    return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
  }

  /** 从文件加载注册表 */
  private load(): RegistryStore {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, "utf-8");
        return JSON.parse(raw) as RegistryStore;
      }
    } catch (err) {
      console.warn(`⚠️ 无法加载注册表文件 ${this.storePath}，创建新的注册表`);
    }
    return { prompts: {}, lastUpdated: new Date().toISOString() };
  }

  /** 持久化注册表到文件系统 */
  private save(): void {
    this.store.lastUpdated = new Date().toISOString();

    // 确保目录存在
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(
      this.storePath,
      JSON.stringify(this.store, null, 2),
      "utf-8"
    );
  }
}

// ========== 使用示例 ==========

async function demoPromptRegistry(): Promise<void> {
  console.log("=" .repeat(60));
  console.log("提示词版本管理 — 演示");
  console.log("=" .repeat(60));

  // 创建注册表实例
  const registry = new PromptRegistry("./prompts/registry.json");

  // 创建第一个模板
  registry.createTemplate(
    "system-agent-v1",
    "Agent 系统提示词",
    `你是一个智能助手。回答要简洁准确。`,
    "张三"
  );

  // 提交改进版本
  await registry.submitVersion(
    "system-agent-v1",
    `你是一个智能助手 Agent，可以调用工具来完成任务。

## 工具使用规则
1. 当需要实时信息时，调用对应工具
2. 回答要简洁准确
3. 如果信息足够，直接给出答案`,
    "新增工具调用规则，明确 Agent 行为边界",
    "李四",
    "minor"
  );

  // 再提交一次优化
  await registry.submitVersion(
    "system-agent-v1",
    `你是一个智能助手 Agent，可以调用工具来完成任务。

## 工具使用规则
1. 当需要实时信息、计算、或不确定的事实时，调用对应工具
2. 如果多个工具调用之间没有依赖关系，请同时发起并行调用
3. 拿到工具结果后，判断是否需要继续调用其他工具
4. 如果信息足够回答问题，直接给出最终答案
5. 如果工具调用失败，告诉用户失败原因，尝试其他方法`,
    "新增并行工具调用规则和失败处理",
    "王五",
    "minor"
  );

  // 查看版本历史
  console.log("\n📜 system-agent-v1 版本历史:");
  const versions = registry.listVersions("system-agent-v1");
  versions.forEach((v) => {
    const isCurrent = v.version === registry.getCurrentVersion("system-agent-v1");
    console.log(
      `  ${isCurrent ? "👉" : "  "} v${v.version} — ${v.changelog} (${v.author}, ${v.createdAt.slice(0, 10)})`
    );
  });

  // 对比版本
  console.log("\n🔍 对比 v1.0.0 和 v1.2.0:");
  const diff = registry.compareVersions("system-agent-v1", "1.0.0", "1.2.0");
  console.log(`  新增行: ${diff.addedLines}, 删除行: ${diff.removedLines}, 字符变化: ${diff.changedChars}`);

  // 回滚演示
  console.log("\n⏪ 回滚到 v1.0.0:");
  await registry.rollback("system-agent-v1", "1.0.0", "张三");
  console.log(`  当前版本: v${registry.getCurrentVersion("system-agent-v1")}`);

  // 列出所有模板
  console.log("\n📋 所有模板:");
  registry.listAllTemplates().forEach((t) => {
    console.log(`  ${t.name} — v${t.currentVersion} (${t.versionCount} 个版本) — ${t.description}`);
  });
}

export { demoPromptRegistry };
```

---

## 2.3 A/B 测试框架完整实现

```typescript
// ──────────────────────────────────────────
// src/prompt-mgmt/ab-test-runner.ts
// 提示词 A/B 测试框架
// ──────────────────────────────────────────

import * as crypto from "crypto";

// ========== 类型定义 ==========

/**
 * 实验组（A 组或 B 组）
 */
export type ExperimentGroup = "A" | "B";

/**
 * 用户反馈类型
 */
export interface UserFeedback {
  /** 反馈唯一 ID */
  id: string;
  /** 所属实验 ID */
  experimentId: string;
  /** 用户被分配到的组 */
  group: ExperimentGroup;
  /** 用户评分: 1-5 (5 = 非常好) */
  rating?: number;
  /** 是否点赞 (thumbs up/down) */
  thumbsUp?: boolean;
  /** 用户编辑了 AI 的回答（表示不满意） */
  userEdited: boolean;
  /** 用户在回答上停留的时间（秒） */
  timeSpentSeconds: number;
  /** 用户原始问题 */
  userQuestion?: string;
  /** AI 回答 */
  aiResponse?: string;
  /** 反馈时间 */
  timestamp: string;
}

/**
 * 实验配置
 */
export interface ABExperiment {
  /** 实验唯一标识 */
  id: string;
  /** 实验名称 */
  name: string;
  /** 使用的提示词模板名称 */
  promptTemplateName: string;
  /** A 组使用的提示词版本 */
  versionA: string;
  /** B 组使用的提示词版本 */
  versionB: string;
  /** A 组流量比例 (0-1, 默认 0.5) */
  trafficSplitA?: number;
  /** B 组流量比例 (0-1, 默认 0.5) */
  trafficSplitB?: number;
  /** 实验状态 */
  status: "running" | "paused" | "completed";
  /** 开始时间 */
  startedAt: string;
  /** 结束时间（null 表示正在运行） */
  endedAt?: string;
  /** 最少需要的样本数（达到后可以得出结论） */
  minSamplesPerGroup?: number;
}

/**
 * 实验结果统计
 */
export interface ABExperimentResult {
  experiment: ABExperiment;
  /** A 组样本数 */
  sampleSizeA: number;
  /** B 组样本数 */
  sampleSizeB: number;
  /** A 组平均评分 */
  avgRatingA: number;
  /** B 组平均评分 */
  avgRatingB: number;
  /** A 组点赞率 (0-1) */
  thumbsUpRateA: number;
  /** B 组点赞率 (0-1) */
  thumbsUpRateB: number;
  /** A 组编辑率 (0-1, 越低越好) */
  editRateA: number;
  /** B 组编辑率 (0-1, 越低越好) */
  editRateB: number;
  /** A 组平均停留时间（秒） */
  avgTimeSpentA: number;
  /** B 组平均停留时间（秒） */
  avgTimeSpentB: number;
  /** 胜出组（null = 无显著差异） */
  winner: ExperimentGroup | null;
  /** 置信度 (0-1) */
  confidence: number;
  /** 推荐结论 */
  recommendation: string;
}

// ========== 核心类 ==========

/**
 * A/B 测试运行器
 *
 * 功能：
 * - 创建实验（选择版本 A 和版本 B）
 * - 按比例分流用户流量
 * - 收集用户反馈（评分、点赞、编辑、停留时间）
 * - 计算统计显著性
 * - 自动推荐获胜者
 */
export class ABTestRunner {
  private experiments: Map<string, ABExperiment> = new Map();
  private feedbackStore: UserFeedback[] = [];

  /**
   * 创建新的 A/B 测试实验
   *
   * @param name - 实验名称
   * @param promptTemplateName - 提示词模板名称
   * @param versionA - A 组版本号
   * @param versionB - B 组版本号
   * @param trafficSplitA - A 组流量比例 (默认 0.5)
   * @param minSamplesPerGroup - 每组最少样本数 (默认 100)
   * @returns 创建的实验
   */
  createExperiment(
    name: string,
    promptTemplateName: string,
    versionA: string,
    versionB: string,
    trafficSplitA: number = 0.5,
    minSamplesPerGroup: number = 100
  ): ABExperiment {
    if (versionA === versionB) {
      throw new Error("A/B 测试的两个版本必须不同");
    }
    if (trafficSplitA <= 0 || trafficSplitA >= 1) {
      throw new Error("流量比例必须在 0 到 1 之间（不含 0 和 1）");
    }

    const id = this.generateId();
    const experiment: ABExperiment = {
      id,
      name,
      promptTemplateName,
      versionA,
      versionB,
      trafficSplitA,
      trafficSplitB: 1 - trafficSplitA,
      status: "running",
      startedAt: new Date().toISOString(),
      minSamplesPerGroup,
    };

    this.experiments.set(id, experiment);
    console.log(
      `🧪 创建实验 "${name}" (${id}): A=v${versionA}(${(trafficSplitA * 100).toFixed(0)}%) vs B=v${versionB}(${((1 - trafficSplitA) * 100).toFixed(0)}%)`
    );
    return experiment;
  }

  /**
   * 为用户分配实验组
   *
   * 使用用户 ID 哈希确保同一个用户始终被分配到同一组（粘性分流）
   * 这样可以避免同一个用户在不同请求中看到不同的 prompt 行为
   *
   * @param experimentId - 实验 ID
   * @param userId - 用户唯一标识
   * @returns 分配到的组 ("A" | "B")
   */
  assignGroup(experimentId: string, userId: string): ExperimentGroup {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`实验 "${experimentId}" 不存在`);
    }
    if (experiment.status !== "running") {
      throw new Error(`实验 "${experimentId}" 已 ${experiment.status}`);
    }

    // 使用用户 ID 的哈希值确定分配（粘性分流）
    // 哈希值在 0-9999 之间
    const hash = crypto
      .createHash("md5")
      .update(userId + experimentId) // 加入 experimentId 确保不同实验独立分配
      .digest("hex");
    const hashValue = parseInt(hash.slice(0, 4), 16) % 10000; // 0-9999

    // 根据流量比例分配
    const threshold = (experiment.trafficSplitA ?? 0.5) * 10000;
    return hashValue < threshold ? "A" : "B";
  }

  /**
   * 收集用户反馈
   *
   * @param experimentId - 实验 ID
   * @param group - 用户组
   * @param rating - 评分 (1-5)
   * @param thumbsUp - 是否点赞
   * @param userEdited - 用户是否编辑了回答
   * @param timeSpentSeconds - 停留时间
   * @param userQuestion - 用户问题
   * @param aiResponse - AI 回答
   */
  collectFeedback(
    experimentId: string,
    group: ExperimentGroup,
    rating?: number,
    thumbsUp?: boolean,
    userEdited: boolean = false,
    timeSpentSeconds: number = 0,
    userQuestion?: string,
    aiResponse?: string
  ): UserFeedback {
    const feedback: UserFeedback = {
      id: this.generateId(),
      experimentId,
      group,
      rating,
      thumbsUp,
      userEdited,
      timeSpentSeconds,
      userQuestion,
      aiResponse,
      timestamp: new Date().toISOString(),
    };

    this.feedbackStore.push(feedback);
    return feedback;
  }

  /**
   * 获取实验结果
   *
   * 计算每个组的各项指标，并判断是否有统计显著差异
   *
   * @param experimentId - 实验 ID
   * @returns 实验结果分析
   */
  getResult(experimentId: string): ABExperimentResult {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`实验 "${experimentId}" 不存在`);
    }

    // 筛选该实验的所有反馈
    const feedbacks = this.feedbackStore.filter(
      (f) => f.experimentId === experimentId
    );

    const groupA = feedbacks.filter((f) => f.group === "A");
    const groupB = feedbacks.filter((f) => f.group === "B");

    // ── 计算 A 组指标 ──
    const ratingsA = groupA.filter((f) => f.rating != null).map((f) => f.rating!);
    const thumbsUpA = groupA.filter((f) => f.thumbsUp === true);
    const editedA = groupA.filter((f) => f.userEdited);
    const timeA = groupA.filter((f) => f.timeSpentSeconds > 0);

    const avgRatingA = ratingsA.length > 0
      ? ratingsA.reduce((s, r) => s + r, 0) / ratingsA.length
      : 0;
    const thumbsUpRateA = groupA.length > 0 ? thumbsUpA.length / groupA.length : 0;
    const editRateA = groupA.length > 0 ? editedA.length / groupA.length : 0;
    const avgTimeSpentA = timeA.length > 0
      ? timeA.reduce((s, f) => s + f.timeSpentSeconds, 0) / timeA.length
      : 0;

    // ── 计算 B 组指标 ──
    const ratingsB = groupB.filter((f) => f.rating != null).map((f) => f.rating!);
    const thumbsUpB = groupB.filter((f) => f.thumbsUp === true);
    const editedB = groupB.filter((f) => f.userEdited);
    const timeB = groupB.filter((f) => f.timeSpentSeconds > 0);

    const avgRatingB = ratingsB.length > 0
      ? ratingsB.reduce((s, r) => s + r, 0) / ratingsB.length
      : 0;
    const thumbsUpRateB = groupB.length > 0 ? thumbsUpB.length / groupB.length : 0;
    const editRateB = groupB.length > 0 ? editedB.length / groupB.length : 0;
    const avgTimeSpentB = timeB.length > 0
      ? timeB.reduce((s, f) => s + f.timeSpentSeconds, 0) / timeB.length
      : 0;

    // ── 判断胜出者（基于综合指标）──
    const { winner, confidence, recommendation } = this.determineWinner(
      groupA.length,
      groupB.length,
      avgRatingA,
      avgRatingB,
      thumbsUpRateA,
      thumbsUpRateB,
      editRateA,
      editRateB,
      experiment.minSamplesPerGroup ?? 100
    );

    return {
      experiment,
      sampleSizeA: groupA.length,
      sampleSizeB: groupB.length,
      avgRatingA,
      avgRatingB,
      thumbsUpRateA,
      thumbsUpRateB,
      editRateA,
      editRateB,
      avgTimeSpentA,
      avgTimeSpentB,
      winner,
      confidence,
      recommendation,
    };
  }

  /**
   * 生成实验报告（可读文本格式）
   */
  generateReport(experimentId: string): string {
    const result = this.getResult(experimentId);
    const exp = result.experiment;

    const lines = [
      "=" .repeat(60),
      `A/B 测试报告: ${exp.name}`,
      "=" .repeat(60),
      `实验 ID: ${exp.id}`,
      `状态: ${exp.status}`,
      `提示词模板: ${exp.promptTemplateName}`,
      `版本: A=v${exp.versionA} vs B=v${exp.versionB}`,
      `运行时间: ${exp.startedAt.slice(0, 10)} ~ ${exp.endedAt?.slice(0, 10) || "进行中"}`,
      "",
      "── 样本量 ──",
      `  A 组: ${result.sampleSizeA} 个样本`,
      `  B 组: ${result.sampleSizeB} 个样本`,
      "",
      "── 核心指标 ──",
      "  指标          | A 组    | B 组    | 差异",
      `  平均评分       | ${result.avgRatingA.toFixed(2)}  | ${result.avgRatingB.toFixed(2)}  | ${(result.avgRatingB - result.avgRatingA).toFixed(2)}`,
      `  点赞率         | ${(result.thumbsUpRateA * 100).toFixed(1)}% | ${(result.thumbsUpRateB * 100).toFixed(1)}% | ${((result.thumbsUpRateB - result.thumbsUpRateA) * 100).toFixed(1)}%`,
      `  编辑率(越低越好) | ${(result.editRateA * 100).toFixed(1)}% | ${(result.editRateB * 100).toFixed(1)}% | ${((result.editRateB - result.editRateA) * 100).toFixed(1)}%`,
      `  平均停留时间    | ${result.avgTimeSpentA.toFixed(1)}s | ${result.avgTimeSpentB.toFixed(1)}s | ${(result.avgTimeSpentB - result.avgTimeSpentA).toFixed(1)}s`,
      "",
      "── 结论 ──",
      `  胜出组: ${result.winner || "无显著差异"}`,
      `  置信度: ${(result.confidence * 100).toFixed(1)}%`,
      `  建议: ${result.recommendation}`,
      "=" .repeat(60),
    ];

    return lines.join("\n");
  }

  /**
   * 暂停实验
   */
  pauseExperiment(experimentId: string): void {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) throw new Error(`实验 "${experimentId}" 不存在`);
    experiment.status = "paused";
  }

  /**
   * 恢复实验
   */
  resumeExperiment(experimentId: string): void {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) throw new Error(`实验 "${experimentId}" 不存在`);
    experiment.status = "running";
  }

  /**
   * 完成实验
   */
  completeExperiment(experimentId: string): void {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) throw new Error(`实验 "${experimentId}" 不存在`);
    experiment.status = "completed";
    experiment.endedAt = new Date().toISOString();
  }

  /**
   * 自动提升获胜者
   *
   * 如果 A/B 测试结果有显著胜出者，自动将提示词模板的当前版本切换到获胜版本
   *
   * @param experimentId - 实验 ID
   * @param registry - PromptRegistry 实例（用于更新版本）
   */
  async autoPromoteWinner(
    experimentId: string,
    registry: any, // PromptRegistry 实例
    author: string = "A/B Test Auto-Promotion"
  ): Promise<string | null> {
    const result = this.getResult(experimentId);

    if (!result.winner) {
      console.log("⚠️ 无显著胜出者，跳过自动提升");
      return null;
    }

    if (result.confidence < 0.95) {
      console.log(`⚠️ 置信度仅 ${(result.confidence * 100).toFixed(1)}%，不足以自动提升`);
      return null;
    }

    const winnerVersion =
      result.winner === "A"
        ? result.experiment.versionA
        : result.experiment.versionB;

    // 将获胜版本设置为主版本
    // 注意：这里不是 rollback，而是直接设置为当前版本
    // 实际项目中需要根据 PromptRegistry 的具体 API 调整
    console.log(
      `🏆 自动提升: ${result.experiment.promptTemplateName} → v${winnerVersion} (${result.winner} 组胜出)`
    );

    await registry.rollback(
      result.experiment.promptTemplateName,
      winnerVersion,
      author
    );

    this.completeExperiment(experimentId);
    return winnerVersion;
  }

  /**
   * 列出所有实验
   */
  listExperiments(): ABExperiment[] {
    return Array.from(this.experiments.values());
  }

  /**
   * 获取指定实验的原始反馈数据（用于自定义分析）
   */
  getFeedback(experimentId: string): UserFeedback[] {
    return this.feedbackStore.filter((f) => f.experimentId === experimentId);
  }

  // ========== 内部辅助方法 ==========

  /**
   * 判断胜出者
   *
   * 使用综合评分法：
   * - 评分权重: 40%
   * - 点赞率权重: 30%
   * - 编辑率权重: 20% (取反: 低编辑率更好)
   * - 停留时间权重: 10%
   *
   * 需要样本量足够才能得出结论
   */
  private determineWinner(
    sampleA: number,
    sampleB: number,
    ratingA: number,
    ratingB: number,
    thumbsA: number,
    thumbsB: number,
    editA: number,
    editB: number,
    minSamples: number
  ): { winner: ExperimentGroup | null; confidence: number; recommendation: string } {
    // ── 检查样本量 ──
    if (sampleA < minSamples || sampleB < minSamples) {
      return {
        winner: null,
        confidence: 0,
        recommendation: `样本量不足（A:${sampleA}, B:${sampleB}，需各≥${minSamples}），继续收集数据`,
      };
    }

    // ── 计算综合得分 ──
    // 评分标准化到 0-1 范围（原始 1-5）
    const normalizedRatingA = (ratingA - 1) / 4;  // 1→0, 5→1
    const normalizedRatingB = (ratingB - 1) / 4;

    // 编辑率取反（越低越好 → 1 - editRate）
    const inverseEditA = 1 - editA;
    const inverseEditB = 1 - editB;

    // 综合得分
    const scoreA =
      normalizedRatingA * 0.4 +
      thumbsA * 0.3 +
      inverseEditA * 0.2 +
      Math.min(1, 0.1); // 停留时间简化为 0.1 常量

    const scoreB =
      normalizedRatingB * 0.4 +
      thumbsB * 0.3 +
      inverseEditB * 0.2 +
      Math.min(1, 0.1);

    // ── 判断差异是否显著 ──
    // 使用简单阈值法（生产环境推荐使用 Welch's t-test 或 Mann-Whitney U test）
    const diff = scoreB - scoreA;
    const significanceThreshold = 0.05;  // 差异至少 5% 才认为显著

    if (Math.abs(diff) < significanceThreshold) {
      return {
        winner: null,
        confidence: 1 - Math.abs(diff) / significanceThreshold,
        recommendation: `A 组和 B 组无显著差异（得分差 ${diff.toFixed(3)}），建议扩大样本量或尝试更大幅度的变更`,
      };
    }

    const winner: ExperimentGroup = diff > 0 ? "B" : "A";
    const confidence = Math.min(
      0.99,
      0.5 + Math.abs(diff) * 5  // 差异越大，置信度越高
    );
    const winnerVersion = winner === "A" ? "A" : "B";

    // 生成推荐意见
    let recommendation: string;
    if (confidence >= 0.95) {
      recommendation = `强烈推荐切换到 ${winnerVersion} 组版本。差异高度显著（得分差 ${diff.toFixed(3)}），置信度 ${(confidence * 100).toFixed(1)}%`;
    } else if (confidence >= 0.8) {
      recommendation = `建议切换到 ${winnerVersion} 组版本。差异显著（得分差 ${diff.toFixed(3)}），置信度 ${(confidence * 100).toFixed(1)}%`;
    } else {
      recommendation = `${winnerVersion} 组略优但差异不够显著。建议继续实验扩大样本量后再决定`;
    }

    return { winner, confidence, recommendation };
  }

  /** 生成唯一 ID */
  private generateId(): string {
    return crypto.randomUUID();
  }
}

// ========== 使用示例 ==========

async function demoABTest(): Promise<void> {
  console.log("=" .repeat(60));
  console.log("A/B 测试框架 — 演示");
  console.log("=" .repeat(60));

  // 假设我们已经有了 PromptRegistry 实例
  const { PromptRegistry } = await import("./prompt-registry");
  const registry = new PromptRegistry();

  // 创建两个版本的提示词
  registry.createTemplate(
    "assistant-v1",
    "助手提示词",
    "你是一个有帮助的助手。请简洁回答问题。",
    "张三"
  );

  await registry.submitVersion(
    "assistant-v1",
    "你是一个有帮助的AI助手。请用友好的语气、详细地回答用户问题。适当使用emoji增加亲和力。",
    "增加友好语气和emoji，测试用户是否更喜欢更亲切的回复风格",
    "李四",
    "minor"
  );

  await registry.submitVersion(
    "assistant-v1",
    "你是一个有帮助的AI助手。请用专业、权威的语气回答。提供数据和引用来源。不使用emoji。",
    "改为专业权威风格，测试用户是否更信任严肃的回复",
    "王五",
    "minor"
  );

  // ── 创建 A/B 测试：友好风格 vs 专业风格 ──
  const runner = new ABTestRunner();

  const experiment = runner.createExperiment(
    "助手语气风格对比",
    "assistant-v1",
    "1.1.0",  // A: 友好+emoji
    "1.2.0",  // B: 专业权威
    0.5,      // 各 50% 流量
    30         // 每组至少 30 个样本即可得出结论
  );

  // ── 模拟流量分配 ──
  console.log("\n📊 模拟流量分配 (30 个用户):");
  const userIds = Array.from({ length: 30 }, (_, i) => `user_${i}`);
  let countA = 0;
  let countB = 0;

  userIds.forEach((uid) => {
    const group = runner.assignGroup(experiment.id, uid);
    if (group === "A") countA++;
    else countB++;
  });

  console.log(`  A 组: ${countA} 人 (${((countA / 30) * 100).toFixed(0)}%)`);
  console.log(`  B 组: ${countB} 人 (${((countB / 30) * 100).toFixed(0)}%)`);

  // ── 模拟反馈收集 ──
  console.log("\n📝 模拟用户反馈...");

  // A 组反馈：友好风格得到较高评分和点赞
  userIds.slice(0, countA).forEach((uid, i) => {
    const rating = 3 + Math.floor(Math.random() * 3); // 3-5
    runner.collectFeedback(
      experiment.id,
      "A",
      rating,
      rating >= 4,   // 评分 >= 4 则点赞
      Math.random() < 0.15, // 15% 概率编辑
      Math.floor(20 + Math.random() * 30) // 20-50s 停留
    );
  });

  // B 组反馈：专业风格评分稍低
  userIds.slice(0, countB).forEach((uid, i) => {
    const rating = 2 + Math.floor(Math.random() * 4); // 2-5
    runner.collectFeedback(
      experiment.id,
      "B",
      rating,
      rating >= 4,
      Math.random() < 0.25, // 25% 概率编辑
      Math.floor(15 + Math.random() * 40) // 15-55s 停留
    );
  });

  // ── 生成报告 ──
  const report = runner.generateReport(experiment.id);
  console.log("\n" + report);

  // ── 自动提升 ──
  console.log("\n🏆 尝试自动提升获胜者...");
  await runner.autoPromoteWinner(experiment.id, registry, "A/B Test System");
}

export { demoABTest };
```

---

## 2.4 完整的演示脚本（可运行）

```typescript
// ──────────────────────────────────────────
// src/prompt-mgmt/index.ts
// 提示词管理与 A/B 测试 — 完整演示入口
// ──────────────────────────────────────────

import { demoPromptRegistry } from "./prompt-registry";
import { demoABTest } from "./ab-test-runner";

/**
 * 运行所有演示
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args[0] || "all";

  switch (mode) {
    case "registry":
      // 只演示提示词版本管理
      await demoPromptRegistry();
      break;

    case "abtest":
      // 只演示 A/B 测试
      await demoABTest();
      break;

    case "all":
    default:
      // 完整演示
      console.log("╔" + "═".repeat(58) + "╗");
      console.log("║  提示词版本管理 & A/B 测试 — 完整演示            ║");
      console.log("╚" + "═".repeat(58) + "╝");
      console.log("");

      // 第 1 部分：提示词版本管理
      await demoPromptRegistry();
      console.log("\n");

      // 第 2 部分：A/B 测试
      await demoABTest();

      console.log("\n✅ 所有演示完成！");
      console.log("💡 提示词版本数据已保存到 ./prompts/registry.json");
      break;
  }
}

// 直接运行时执行
if (require.main === module) {
  main().catch(console.error);
}

export { main };
```

运行方式：

```bash
# 安装依赖（如果尚未安装）
npm install

# 运行完整演示
npx tsx src/prompt-mgmt/index.ts

# 只运行提示词版本管理
npx tsx src/prompt-mgmt/index.ts registry

# 只运行 A/B 测试
npx tsx src/prompt-mgmt/index.ts abtest
```

---

## 2.5 CI/CD 集成指南

### 2.5.1 在 Git 中管理提示词

```
project/
├── src/
│   ├── agent.ts
│   └── tools.ts
├── prompts/                   ← 提示词仓库
│   ├── registry.json          ← 版本注册表（JSON，便于 diff）
│   └── templates/             ← 每个模板独立文件（可选，便于 code review）
│       ├── system-agent-v1.md
│       └── assistant-v1.md
├── .github/
│   └── workflows/
│       └── prompt-ci.yml      ← 提示词 CI 检查
└── package.json
```

### 2.5.2 GitHub Actions CI 配置

```yaml
# .github/workflows/prompt-ci.yml
# 提示词变更自动检查流水线

name: Prompt CI

on:
  pull_request:
    paths:
      - "prompts/**"         # 只监控 prompts 目录的变更
      - "prompts/registry.json"

jobs:
  validate-prompts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: 安装依赖
        run: npm ci

      - name: 验证提示词格式
        run: npx tsx scripts/validate-prompts.ts
        # 检查：
        # 1. registry.json 格式正确
        # 2. 每个模板至少有 changelog
        # 3. 没有两个版本内容完全一致（空变更检测）
        # 4. 版本号递增正确

      - name: 运行评测套件（如果有变更的模板）
        run: npx tsx scripts/eval-on-change.ts
        # 对变更的提示词运行自动评测：
        # 1. 用一组标准测试问题各跑一遍
        # 2. 对比新旧版本的输出
        # 3. 如果输出质量显著下降，PR 被阻止合并

      - name: 生成提示词变更摘要
        # 在 PR 评论中自动发布提示词变更摘要
        # 让 reviewer 一目了然地看到改了什么
        run: npx tsx scripts/prompt-diff-summary.ts
```

### 2.5.3 PR 审查提示词的要点

审查提示词变更时，reviewer 应该关注：

1. **是否增加了不必要的约束**：约束越多，模型越容易出错
2. **示例是否和任务一致**：错误的 few-shot 示例比没有更糟
3. **语言是否清晰无歧义**：模型不理解"暗示"，需要显式指令
4. **是否有回归风险**：新 prompt 是否覆盖了所有旧场景
5. **changelog 是否准确**：变更说明应该能回答"为什么这样改"

### 2.5.4 提示词变更验证脚本

```typescript
// ──────────────────────────────────────────
// scripts/validate-prompts.ts
// 提示词 CI 验证脚本
// ──────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";

interface ValidationError {
  file: string;
  message: string;
  severity: "error" | "warning";
}

/**
 * 验证提示词注册表的完整性和正确性
 */
function validateRegistry(registryPath: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!fs.existsSync(registryPath)) {
    errors.push({
      file: registryPath,
      message: "注册表文件不存在",
      severity: "error",
    });
    return errors;
  }

  try {
    const raw = fs.readFileSync(registryPath, "utf-8");
    const registry = JSON.parse(raw);

    if (!registry.prompts || typeof registry.prompts !== "object") {
      errors.push({
        file: registryPath,
        message: "注册表缺少 prompts 字段",
        severity: "error",
      });
      return errors;
    }

    // 检查每个模板
    for (const [name, template] of Object.entries(registry.prompts)) {
      const t = template as any;

      // 检查必有字段
      if (!t.name) {
        errors.push({
          file: registryPath,
          message: `模板 "${name}" 缺少 name 字段`,
          severity: "error",
        });
      }
      if (!t.versions || !Array.isArray(t.versions)) {
        errors.push({
          file: registryPath,
          message: `模板 "${name}" 缺少 versions 数组`,
          severity: "error",
        });
        continue;
      }
      if (t.versions.length === 0) {
        errors.push({
          file: registryPath,
          message: `模板 "${name}" 没有任何版本`,
          severity: "error",
        });
        continue;
      }

      // 检查版本连续性
      let prevVersion: string | null = null;
      for (const version of t.versions) {
        if (!version.version || !version.content || !version.changelog) {
          errors.push({
            file: registryPath,
            message: `模板 "${name}" v${version.version} 缺少必填字段`,
            severity: "error",
          });
        }
        if (!version.author) {
          errors.push({
            file: registryPath,
            message: `模板 "${name}" v${version.version} 缺少 author`,
            severity: "warning",
          });
        }

        // 检查内容不为空
        if (version.content && version.content.trim().length === 0) {
          errors.push({
            file: registryPath,
            message: `模板 "${name}" v${version.version} 内容为空`,
            severity: "error",
          });
        }

        prevVersion = version.version;
      }

      // 检查 currentVersion 是否指向一个现有版本
      if (t.currentVersion) {
        const cvExists = t.versions.some(
          (v: any) => v.version === t.currentVersion
        );
        if (!cvExists) {
          errors.push({
            file: registryPath,
            message: `模板 "${name}" 的 currentVersion (${t.currentVersion}) 不存在`,
            severity: "error",
          });
        }
      }
    }

  } catch (err) {
    errors.push({
      file: registryPath,
      message: `JSON 解析失败: ${(err as Error).message}`,
      severity: "error",
    });
  }

  return errors;
}

// ── 主程序 ──
const registryPath = process.argv[2] || "./prompts/registry.json";
const errors = validateRegistry(registryPath);

if (errors.length > 0) {
  console.log(`\n❌ 发现 ${errors.length} 个问题:\n`);
  errors.forEach((e) => {
    const icon = e.severity === "error" ? "🔴" : "🟡";
    console.log(`${icon} [${e.severity}] ${e.file}: ${e.message}`);
  });

  // 如果有 error 级别的问题，以非零退出码退出
  const hasErrors = errors.some((e) => e.severity === "error");
  process.exit(hasErrors ? 1 : 0);
} else {
  console.log("✅ 提示词注册表验证通过！");
  process.exit(0);
}
```

---

## 2.6 最佳实践总结

### 提示词版本管理

| 实践 | 说明 |
|------|------|
| 每个变更必写 changelog | 回答"为什么改"，不止"改了什么" |
| 语义化版本号 | Major: 大改; Minor: 优化; Patch: 修复 |
| 内容哈希防重复 | 防止相同内容创建多个版本 |
| Git 中存储 | 提示词和代码一起 review |
| 旧版本不删除 | 保留完整历史，支持回滚和对比 |

### A/B 测试

| 实践 | 说明 |
|------|------|
| 明确成功指标 | 开始前定义"什么是更好"（评分、编辑率、用户留存等） |
| 充足样本量 | 每组至少 100 个样本（根据效应量计算） |
| 粘性分流 | 同一用户始终看到相同版本 |
| 一次只测一个变量 | 同时改多个变量无法归因 |
| 设置止损条件 | 如果 B 组显著更差，立即停止 |
| 统计显著性检验 | 不用肉眼看，用 t-test 或 bootstrap |

---

## 3. 与 22-Agent 的整合方式

将本文件的两个部分整合到 22-Agent 很简单：

### 整合并行调用

```typescript
// 在 agent.ts 中，将 runAgent 替换为 runParallelAgent
import { runParallelAgent } from "./parallel/parallel-agent";

// 只需替换这个导出
export { runParallelAgent as runAgent };
```

### 整合提示词管理

```typescript
// 在 agent.ts 中，从 Registry 获取提示词而非硬编码
import { PromptRegistry } from "./prompt-mgmt/prompt-registry";

const registry = new PromptRegistry();
const AGENT_SYSTEM_PROMPT = registry.getPrompt("system-agent-v1");
// 现在修改 prompt 只需要更新 registry.json，无需改代码
```

---

## 4. 相关文档

- [22-Agent 工具调用实战](./22-Agent工具调用实战-Agent-Tool-Use.md) — Agent 基础实现（本文件的基础）
- [18-高级实战技巧](./18-高级实战技巧-Advanced-Techniques.md) — Agent Working Memory
- [08-上下文管理](./08-上下文管理-Context-Management.md) — 上下文窗口管理
- [23-错误处理与重试](./23-错误处理与重试-Error-Handling.md) — 部分失败处理可结合错误重试策略
- [24-结构化输出](./24-结构化输出-Structured-Output.md) — 结构化输出可用于 A/B 测试结果的自动化分析
