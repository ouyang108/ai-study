# 23. AI API 错误处理与重试机制

> **核心问题**：每一个 AI API 调用都有可能失败。429 限流、500 服务端错误、超时、内容过滤——如果不做处理，单次失败就可能拖垮整个应用。本章提供一套生产级的错误处理方案，让你的 AI 应用稳如磐石。

---

## 目录

1. [AI API 调用的常见错误类型](#1-ai-api-调用的常见错误类型)
2. [错误处理的核心原则](#2-错误处理的核心原则)
3. [指数退避重试（Exponential Backoff）](#3-指数退避重试exponential-backoff)
4. [模型降级策略（Fallback Chain）](#4-模型降级策略fallback-chain)
5. [速率限制处理（Rate Limiting）](#5-速率限制处理rate-limiting)
6. [完整的 RobustAIClient 类](#6-完整的-robustaiclient-类)
7. [使用示例](#7-使用示例)

---

## 1. AI API 调用的常见错误类型

在开始写代码之前，必须先认清"敌人"。以下是 AI API 最常见的 7 种错误：

| 错误类型 | HTTP 状态码 | 触发场景 | 严重程度 | 是否可重试 |
|---------|------------|---------|---------|-----------|
| **Rate Limit（限流）** | 429 | 短时间内发起了太多请求，超过了提供商的速率上限 | 高 | **是**（需等待后重试） |
| **Server Error（服务端错误）** | 500 / 502 / 503 | 服务提供商的服务器出现临时故障、过载或维护 | 中 | **是**（故障通常短暂） |
| **Timeout（超时）** | 无 / 408 | 请求耗时过长（大上下文、推理模型尤其容易遇到） | 中 | **是**（可能只是偶发） |
| **Content Filter（内容过滤）** | 400 | 输入或输出触发了安全过滤系统（敏感话题、违规内容） | 低-中 | **否**（修改输入后重试） |
| **Context Length Exceeded** | 400 | 发送的 token 数量超过了模型的上下文窗口上限 | 中 | **否**（需要截断输入） |
| **Auth Error（认证错误）** | 401 / 403 | API Key 无效、过期或权限不足 | 严重 | **否**（修复 Key 后重试） |
| **Connection Error（连接错误）** | 无 | 网络不稳定、DNS 解析失败、代理问题 | 中 | **是**（网络波动可恢复） |

### 1.1 错误类型定义

```typescript
/**
 * AI API 错误分类枚举
 * 用于在代码中统一识别和处理不同类型的错误
 */
enum AIErrorType {
  /** 速率限制 —— 调用频率超过配额 */
  RATE_LIMIT = 'RATE_LIMIT',
  /** 服务端错误 —— 提供商暂时不可用 */
  SERVER_ERROR = 'SERVER_ERROR',
  /** 请求超时 —— 响应时间超过设定阈值 */
  TIMEOUT = 'TIMEOUT',
  /** 内容过滤 —— 输入或输出被安全系统拦截 */
  CONTENT_FILTER = 'CONTENT_FILTER',
  /** 上下文超长 —— Token 超过模型限制 */
  CONTEXT_LENGTH_EXCEEDED = 'CONTEXT_LENGTH_EXCEEDED',
  /** 认证错误 —— API Key 无效或过期 */
  AUTH_ERROR = 'AUTH_ERROR',
  /** 连接错误 —— 网络层面的问题 */
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  /** 未知错误 —— 无法归类的异常 */
  UNKNOWN = 'UNKNOWN',
}

/**
 * 封装后的 AI 错误对象
 * 相比原始 Error，携带了更多用于决策的上下文信息
 */
class AIError extends Error {
  /** 错误分类 */
  type: AIErrorType;
  /** HTTP 状态码（如果来自 HTTP 响应） */
  statusCode?: number;
  /** 是否值得重试 */
  retryable: boolean;
  /** 服务端建议的等待秒数（取自 Retry-After 响应头） */
  retryAfterSeconds?: number;
  /** 发生错误时使用的模型名称 */
  modelName?: string;
  /** 请求 ID（用于联系提供商排查） */
  requestId?: string;
  /** 原始错误对象 */
  originalError: unknown;

  constructor(params: {
    message: string;
    type: AIErrorType;
    statusCode?: number;
    retryable: boolean;
    retryAfterSeconds?: number;
    modelName?: string;
    requestId?: string;
    originalError?: unknown;
  }) {
    super(params.message);
    this.name = 'AIError';
    this.type = params.type;
    this.statusCode = params.statusCode;
    this.retryable = params.retryable;
    this.retryAfterSeconds = params.retryAfterSeconds;
    this.modelName = params.modelName;
    this.requestId = params.requestId;
    this.originalError = params.originalError ?? null;
  }
}
```

### 1.2 错误分类器

```typescript
/**
 * 将原始错误（来自 fetch、OpenAI SDK 等）分类为 AIError
 * 这是整个错误处理管道的入口 —— 所有错误先经过这里"贴标签"
 */
function classifyError(rawError: unknown, modelName?: string): AIError {
  // 情况1: 已经是 AIError，直接返回
  if (rawError instanceof AIError) {
    return rawError;
  }

  // 情况2: OpenAI / Anthropic SDK 的标准错误对象
  // 大多数 SDK 的错误都遵循类似结构：error.status / error.code / error.type
  const err = rawError as Record<string, any> | null;
  const status = err?.status ?? err?.statusCode ?? err?.response?.status;
  const message: string = err?.message ?? err?.error?.message ?? String(rawError);
  const errorCode: string = err?.code ?? err?.error?.code ?? err?.type ?? '';
  const headers = err?.response?.headers ?? err?.headers ?? {};

  // 提取 Retry-After 响应头（有些提供商会在 429 响应中给出建议等待时间）
  const retryAfterRaw = headers?.['retry-after'] ?? headers?.['Retry-After'];
  const retryAfterSeconds = retryAfterRaw ? parseInt(retryAfterRaw, 10) : undefined;

  // 401 / 403 → 认证错误
  if (status === 401 || status === 403) {
    return new AIError({
      message: `[认证失败] ${message}`,
      type: AIErrorType.AUTH_ERROR,
      statusCode: status,
      retryable: false,
      modelName,
      originalError: rawError,
    });
  }

  // 429 → 速率限制
  if (status === 429) {
    return new AIError({
      message: `[速率限制] ${message}`,
      type: AIErrorType.RATE_LIMIT,
      statusCode: status,
      retryable: true,
      retryAfterSeconds: retryAfterSeconds ?? 10, // 没给的话默认等10秒
      modelName,
      originalError: rawError,
    });
  }

  // 5xx → 服务端错误
  if (status !== undefined && status >= 500 && status < 600) {
    return new AIError({
      message: `[服务器错误 ${status}] ${message}`,
      type: AIErrorType.SERVER_ERROR,
      statusCode: status,
      retryable: true,
      retryAfterSeconds: retryAfterSeconds,
      modelName,
      originalError: rawError,
    });
  }

  // 超时检测 —— 通过错误消息关键字判断
  const lowerMessage = message.toLowerCase();
  if (
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('timed out') ||
    lowerMessage.includes('etimedout') ||
    lowerMessage.includes('econnreset')
  ) {
    return new AIError({
      message: `[请求超时] ${message}`,
      type: AIErrorType.TIMEOUT,
      statusCode: status,
      retryable: true,
      modelName,
      originalError: rawError,
    });
  }

  // 上下文长度超限
  if (
    lowerMessage.includes('context length') ||
    lowerMessage.includes('too many tokens') ||
    lowerMessage.includes('maximum context') ||
    lowerMessage.includes('max tokens') ||
    lowerMessage.includes('token limit')
  ) {
    return new AIError({
      message: `[上下文超限] ${message}`,
      type: AIErrorType.CONTEXT_LENGTH_EXCEEDED,
      statusCode: status ?? 400,
      retryable: false,
      modelName,
      originalError: rawError,
    });
  }

  // 内容过滤
  if (
    lowerMessage.includes('content filter') ||
    lowerMessage.includes('content_policy_violation') ||
    lowerMessage.includes('safety') ||
    lowerMessage.includes('moderation') ||
    lowerMessage.includes('inappropriate')
  ) {
    return new AIError({
      message: `[内容过滤] ${message}`,
      type: AIErrorType.CONTENT_FILTER,
      statusCode: status ?? 400,
      retryable: false,
      modelName,
      originalError: rawError,
    });
  }

  // 网络连接错误
  if (
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('enotfound') ||
    lowerMessage.includes('econnreset') ||
    lowerMessage.includes('network') ||
    lowerMessage.includes('fetch failed')
  ) {
    return new AIError({
      message: `[连接错误] ${message}`,
      type: AIErrorType.CONNECTION_ERROR,
      retryable: true,
      modelName,
      originalError: rawError,
    });
  }

  // 无法归类 → 标记为 UNKNOWN，保守起见不重试
  return new AIError({
    message: `[未知错误] ${message}`,
    type: AIErrorType.UNKNOWN,
    statusCode: status,
    retryable: false,
    modelName,
    originalError: rawError,
  });
}

export { AIErrorType, AIError, classifyError };
```

---

## 2. 错误处理的核心原则

在开始写重试逻辑之前，先确立几条"铁律"：

### 原则 1：绝不让单次失败拖垮整个应用

```typescript
/**
 * ❌ 错误做法：没有任何保护，一次失败直接崩溃
 */
async function badExample() {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello' }],
  });
  // 如果上面抛异常，整个进程就炸了
  console.log(response);
}

/**
 * ✅ 正确做法：用 try-catch 包裹，失败有兜底
 */
async function goodExample() {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    return response.choices[0].message.content;
  } catch (error) {
    // 记录日志
    console.error('[AI调用失败]', error);
    // 返回一个兜底响应，而不是让应用崩溃
    return '抱歉，AI 服务暂时不可用，请稍后重试。';
  }
}
```

### 原则 2：永远准备一个降级模型

```typescript
/**
 * 不要只依赖一个模型。当主模型不可用时，自动切换到备选。
 * 就像飞机有主发动机和备用发动机一样。
 */
const MODEL_FALLBACK_CHAIN = [
  'gpt-4o',           // 首选：能力最强
  'claude-sonnet-4',  // 备选1：Anthropic 家的
  'deepseek-v3',      // 备选2：性价比高
  'gpt-4o-mini',      // 最后兜底：响应快、便宜
];
```

### 原则 3：记录每一次错误及其上下文

```typescript
/**
 * 错误日志应该包含足够多的信息来帮助定位问题
 * 不记录原始消息内容（隐私），但记录元信息
 */
interface ErrorLogEntry {
  /** 时间戳 */
  timestamp: string;
  /** 错误类型 */
  errorType: AIErrorType;
  /** 错误消息 */
  message: string;
  /** 使用的模型 */
  modelName?: string;
  /** 重试次数 */
  retryAttempt: number;
  /** 请求 ID（用于联系提供商） */
  requestId?: string;
  /** 延迟毫秒数 */
  latencyMs: number;
}

const errorLog: ErrorLogEntry[] = [];

function logError(entry: ErrorLogEntry): void {
  errorLog.push(entry);
  // 同时输出到控制台（生产环境应使用专业日志库如 pino / winston）
  console.error(
    `[AI-ERROR] ${entry.timestamp} | ${entry.errorType} | model=${entry.modelName} | ` +
    `retry=${entry.retryAttempt} | latency=${entry.latencyMs}ms | ${entry.message}`
  );
}
```

### 原则 4：尊重速率限制，不要野蛮重试

```typescript
/**
 * 收到 429 后，应该等待而不是立刻重试。
 * 如果提供商给了 Retry-After 头，就按它说的等。
 * 如果没给，用指数退避算出等待时间，加上随机抖动。
 * 
 * 野蛮重试（立刻重试、固定间隔重试）只会让情况更糟：
 * - 你被打上"不守规矩的客户端"标签
 * - 可能被临时或永久封禁
 * - 加重服务端负担，延长恢复时间
 */
```

---

## 3. 指数退避重试（Exponential Backoff）

这是整个章节最核心的工具函数。工作原理：

1. 第一次失败等待 1 秒后重试
2. 第二次失败等待 2 秒后重试
3. 第三次失败等待 4 秒后重试
4. …以此类推（指数增长）
5. 每次等待时间加上随机抖动（jitter），防止多个客户端同时重试造成"惊群效应"
6. 如果服务端返回了 `Retry-After` 头，优先使用它的建议值

### 3.1 完整实现

```typescript
/**
 * 带指数退避的重试包装器
 * 
 * 核心设计：
 * - 只重试"可恢复"的错误（429, 5xx, timeout, connection error）
 * - 不可恢复的错误（401, context length exceeded, content filter）直接抛出
 * - 每次重试的等待时间指数增长，带有随机抖动
 * - 优先遵守服务端的 Retry-After 头
 * - 达到最大重试次数后抛出最终错误
 * 
 * @param fn          - 要执行的异步函数
 * @param options     - 重试配置选项
 * @returns           - fn 的返回值（如果成功）
 * 
 * @example
 * const result = await withRetry(
 *   () => openai.chat.completions.create({ model: 'gpt-4o', messages: [...] }),
 *   { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000 }
 * );
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,            // 最大重试次数
    baseDelayMs = 1000,        // 基础等待时间（1秒）
    maxDelayMs = 30000,        // 最大等待上限（30秒）
    jitterFactor = 0.3,        // 抖动因子（30%），让等待时间在 70%~130% 之间随机浮动
    onRetry = undefined,       // 每次重试时的回调（用于日志和监控）
    shouldRetry = undefined,   // 自定义重试判断逻辑
    signal = undefined,        // AbortSignal，用于外部取消
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // 检查是否被外部取消
    if (signal?.aborted) {
      throw new AIError({
        message: '请求已被取消',
        type: AIErrorType.UNKNOWN,
        retryable: false,
      });
    }

    try {
      // 执行目标函数
      return await fn();
    } catch (rawError) {
      lastError = rawError;
      const aiError = classifyError(rawError);

      // 如果这是最后一次尝试，不再重试，直接抛出错误
      if (attempt >= maxRetries) {
        console.error(
          `[重试耗尽] 已尝试 ${attempt + 1} 次（含初始调用），仍然失败。` +
          `model=${aiError.modelName}, type=${aiError.type}`
        );
        throw aiError;
      }

      // 判断是否应该重试：
      // 优先使用用户自定义的判断逻辑
      // 其次检查我们的分类是否为"可重试"类型
      const userWantsRetry = shouldRetry ? shouldRetry(aiError, attempt) : undefined;
      if (userWantsRetry === false || (!userWantsRetry && !aiError.retryable)) {
        console.warn(
          `[不可重试] type=${aiError.type}, model=${aiError.modelName}, ` +
          `跳过重试，直接抛出错误。`
        );
        throw aiError;
      }

      // 计算等待时间（毫秒）
      const delayMs = calculateBackoffDelay({
        attempt,
        baseDelayMs,
        maxDelayMs,
        jitterFactor,
        retryAfterSeconds: aiError.retryAfterSeconds,
      });

      // 触发回调（用于日志等外部操作）
      if (onRetry) {
        onRetry({
          error: aiError,
          attempt: attempt + 1,
          maxRetries,
          delayMs,
          timestamp: new Date().toISOString(),
        });
      }

      console.warn(
        `[重试] 第 ${attempt + 1}/${maxRetries} 次重试，` +
        `等待 ${(delayMs / 1000).toFixed(1)}s 后重试... ` +
        `(错误类型: ${aiError.type})`
      );

      // 等待
      await sleep(delayMs);
    }
  }

  // 理论上不会走到这里（循环内一定会 return 或 throw），但 TypeScript 需要这个
  throw lastError;
}

// ==================== 辅助类型和函数 ====================

/** 重试配置选项 */
interface RetryOptions {
  /** 最大重试次数（不含初始调用），默认 3 */
  maxRetries?: number;
  /** 基础等待时间（毫秒），默认 1000 */
  baseDelayMs?: number;
  /** 最大等待时间（毫秒），默认 30000 */
  maxDelayMs?: number;
  /** 抖动因子（0~1），默认 0.3（即 30%） */
  jitterFactor?: number;
  /** 每次重试前的回调 */
  onRetry?: (info: RetryInfo) => void;
  /** 自定义重试判断，返回 false 则放弃重试 */
  shouldRetry?: (error: AIError, attempt: number) => boolean;
  /** 外部取消信号 */
  signal?: AbortSignal;
}

/** 重试回调信息 */
interface RetryInfo {
  /** 分类后的错误 */
  error: AIError;
  /** 这是第几次重试（从 1 开始） */
  attempt: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 本次等待的毫秒数 */
  delayMs: number;
  /** 时间戳 */
  timestamp: string;
}

/** 计算退避延迟的内部参数 */
interface BackoffParams {
  /** 当前是第几次尝试（从 0 开始） */
  attempt: number;
  /** 基础延迟 */
  baseDelayMs: number;
  /** 延迟上限 */
  maxDelayMs: number;
  /** 抖动因子 */
  jitterFactor: number;
  /** 服务端建议的等待秒数 */
  retryAfterSeconds?: number;
}

/**
 * 计算指数退避的等待时间
 * 
 * 公式：delay = min(baseDelay * 2^attempt, maxDelay)
 * 然后加上 ±jitterFactor 的随机抖动
 * 
 * 如果服务端给出了 Retry-After，优先使用它（尊重服务端的策略）
 */
function calculateBackoffDelay(params: BackoffParams): number {
  const { attempt, baseDelayMs, maxDelayMs, jitterFactor, retryAfterSeconds } = params;

  // 优先使用服务端的建议
  if (retryAfterSeconds !== undefined && retryAfterSeconds > 0) {
    const serverDelayMs = retryAfterSeconds * 1000;
    // 在服务端建议的基础上也加一点抖动
    const jitter = serverDelayMs * jitterFactor * (Math.random() * 2 - 1);
    return Math.min(serverDelayMs + jitter, maxDelayMs);
  }

  // 指数退避：基础延迟 × 2^尝试次数
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);

  // 加上限
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // 加上随机抖动，范围是 [1 - jitterFactor, 1 + jitterFactor]
  const jitter = cappedDelay * jitterFactor * (Math.random() * 2 - 1);
  const finalDelay = Math.round(cappedDelay + jitter);

  // 确保不小于 0
  return Math.max(0, finalDelay);
}

/**
 * Promise 版的 sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### 3.2 退避时间可视化

```typescript
/**
 * 测试：打印退避时间序列，直观感受指数增长
 * 
 * baseDelayMs=1000, jitterFactor=0 时（无抖动）：
 *   尝试 0:    0ms（初始调用，不等待）
 *   尝试 1: 1000ms（1秒）
 *   尝试 2: 2000ms（2秒）
 *   尝试 3: 4000ms（4秒）
 *   尝试 4: 8000ms（8秒）
 *   尝试 5: 16000ms（16秒）
 * 
 * 有抖动时，每次的实际等待时间会在理论值的 ±30% 范围内波动
 */
function demoBackoffTimeline(): void {
  console.log('=== 指数退避等待时间演示（baseDelayMs=1000, jitterFactor=0.3） ===');
  for (let attempt = 0; attempt < 5; attempt++) {
    const delayMs = calculateBackoffDelay({
      attempt,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      jitterFactor: 0.3,
    });
    console.log(`  第 ${attempt + 1} 次失败后等待: ${(delayMs / 1000).toFixed(2)}s`);
  }
}
```

---

## 4. 模型降级策略（Fallback Chain）

当你只有一个模型时，模型挂了你就挂了。解决方案：维护一个模型优先级列表，主模型不可用时自动切换到备选。

### 4.1 熔断器模式（Circuit Breaker）

熔断器是"降级策略"的核心组件。如果一个模型连续失败，就临时"熔断"它（标记为不健康），等一段时间后再给它"半开"机会。

```typescript
/**
 * 熔断器状态枚举
 * - CLOSED:   正常状态，请求正常通过
 * - OPEN:     熔断状态，拒绝所有请求（直接抛错，不调用模型）
 * - HALF_OPEN: 半开状态，放行少量请求做试探
 */
enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * 模型熔断器
 * 
 * 工作原理：
 * 1. 正常情况下处于 CLOSED 状态，请求正常通过
 * 2. 当连续失败次数达到 threshold（比如 3 次），状态变为 OPEN
 * 3. OPEN 状态下所有请求直接拒绝
 * 4. 经过 recoveryTimeMs（比如 30 秒）后，状态变为 HALF_OPEN
 * 5. HALF_OPEN 状态下放行一个请求试探：
 *    - 试探成功 → 回到 CLOSED（恢复正常）
 *    - 试探失败 → 回到 OPEN（继续熔断）
 */
class CircuitBreaker {
  /** 当前状态 */
  private state: CircuitState = CircuitState.CLOSED;
  /** 连续失败计数 */
  private failureCount: number = 0;
  /** 熔断开始的时间戳（用于判断是否可以进入 HALF_OPEN） */
  private openedAt: number = 0;
  /** 连续失败多少次后触发熔断 */
  private failureThreshold: number;
  /** 熔断后的恢复等待时间（毫秒） */
  private recoveryTimeMs: number;
  /** 模型名称（仅用于日志） */
  private modelName: string;

  constructor(
    modelName: string,
    failureThreshold: number = 3,
    recoveryTimeMs: number = 30_000
  ) {
    this.modelName = modelName;
    this.failureThreshold = failureThreshold;
    this.recoveryTimeMs = recoveryTimeMs;
  }

  /**
   * 尝试获取"通行许可"
   * 如果返回 true，表示可以放行请求
   * 如果返回 false，表示当前处于熔断状态，应该跳过该模型
   */
  allowRequest(): boolean {
    switch (this.state) {
      case CircuitState.CLOSED:
        // 正常状态 → 放行
        return true;

      case CircuitState.OPEN: {
        // 熔断状态 → 检查是否已超过恢复时间
        const elapsed = Date.now() - this.openedAt;
        if (elapsed >= this.recoveryTimeMs) {
          // 进入半开状态，放行本次请求做试探
          this.state = CircuitState.HALF_OPEN;
          console.log(
            `[熔断器] ${this.modelName}: OPEN → HALF_OPEN（已熔断 ${(elapsed / 1000).toFixed(1)}s，放行试探请求）`
          );
          return true;
        }
        // 恢复时间未到，继续拒绝
        return false;
      }

      case CircuitState.HALF_OPEN:
        // 半开状态 → 前一次试探可能还在进行，这里只放行一个
        // 实际使用中需要更精细的控制（比如用一个计数器），这里简化为：半开状态允许请求
        return true;

      default:
        return false;
    }
  }

  /**
   * 报告一次成功
   * 成功后重置所有计数器，回到 CLOSED 状态
   */
  recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      console.log(
        `[熔断器] ${this.modelName}: HALF_OPEN → CLOSED（试探成功，恢复正常）`
      );
    }
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.openedAt = 0;
  }

  /**
   * 报告一次失败
   * 如果连续失败达到阈值，触发熔断
   */
  recordFailure(): void {
    this.failureCount++;

    if (this.state === CircuitState.HALF_OPEN) {
      // 半开状态下的试探也失败了 → 继续熔断
      this.state = CircuitState.OPEN;
      this.openedAt = Date.now();
      console.warn(
        `[熔断器] ${this.modelName}: HALF_OPEN → OPEN（试探请求也失败了，继续熔断 ${this.recoveryTimeMs / 1000}s）`
      );
      return;
    }

    if (this.state === CircuitState.CLOSED && this.failureCount >= this.failureThreshold) {
      // 连续失败达到阈值 → 触发熔断
      this.state = CircuitState.OPEN;
      this.openedAt = Date.now();
      console.warn(
        `[熔断器] ${this.modelName}: CLOSED → OPEN（连续失败 ${this.failureCount} 次，熔断 ${this.recoveryTimeMs / 1000}s）`
      );
    }
  }

  /** 获取当前状态信息（用于监控和调试） */
  getStatus(): { state: string; failureCount: number; modelName: string } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      modelName: this.modelName,
    };
  }
}
```

### 4.2 多模型客户端

```typescript
/**
 * 模型配置
 * 定义每个模型的基本信息：名称、提供商、优先级
 */
interface ModelConfig {
  /** 模型名称（如 gpt-4o, claude-sonnet-4-20250514） */
  name: string;
  /** 提供商（openai / anthropic / deepseek） */
  provider: 'openai' | 'anthropic' | 'deepseek';
  /** API Key（从环境变量读取） */
  apiKey: string;
  /** API 基础 URL */
  baseURL: string;
  /** 优先级（数字越小越优先） */
  priority: number;
}

/**
 * 多模型客户端 —— 带熔断和自动降级
 * 
 * 核心流程：
 * 1. 按优先级排序模型列表
 * 2. 依次尝试每个模型
 * 3. 对于每个模型：
 *    a. 检查熔断器 —— 如果熔断了就跳过
 *    b. 发起请求（带重试）
 *    c. 成功 → 记录成功，返回结果
 *    d. 失败 → 记录失败，尝试下一个模型
 * 4. 所有模型都失败 → 返回兜底响应
 */
class MultiModelClient {
  /** 按优先级排序的模型列表 */
  private models: ModelConfig[];
  /** 每个模型对应的熔断器 */
  private circuitBreakers: Map<string, CircuitBreaker>;
  /** 兜底响应（所有模型都失败时使用） */
  private fallbackMessage: string;
  /** 缓存 —— 存最近的成功响应，作为最后一道防线 */
  private responseCache: Map<string, { response: string; timestamp: number }>;
  /** 缓存有效期（毫秒），默认 5 分钟 */
  private cacheTTLMs: number;

  constructor(
    models: ModelConfig[],
    options: {
      fallbackMessage?: string;
      cacheTTLMs?: number;
    } = {}
  ) {
    // 按优先级升序排列
    this.models = [...models].sort((a, b) => a.priority - b.priority);
    this.circuitBreakers = new Map();
    this.responseCache = new Map();
    this.fallbackMessage = options.fallbackMessage ?? '抱歉，当前 AI 服务不可用，请稍后重试。';
    this.cacheTTLMs = options.cacheTTLMs ?? 5 * 60 * 1000; // 5分钟

    // 为每个模型创建独立的熔断器
    for (const model of this.models) {
      this.circuitBreakers.set(model.name, new CircuitBreaker(model.name, 3, 30_000));
    }

    console.log(
      `[MultiModelClient] 初始化完成，${this.models.length} 个模型就绪。` +
      `优先级: ${this.models.map((m) => m.name).join(' → ')}`
    );
  }

  /**
   * 发送聊天请求（带自动降级）
   * 
   * @param messages   - 消息数组
   * @param cacheKey   - 缓存键（可选，用于缓存兜底）
   * @param maxRetries - 每个模型的最大重试次数
   * @returns          - AI 的响应文本
   */
  async chat(
    messages: { role: string; content: string }[],
    options: {
      cacheKey?: string;
      maxRetries?: number;
    } = {}
  ): Promise<string> {
    const { cacheKey, maxRetries = 2 } = options;
    const startTime = Date.now();

    // 遍历优先级列表（已按 priority 排序）
    for (const model of this.models) {
      const breaker = this.circuitBreakers.get(model.name)!;

      // 检查熔断器：如果已熔断，直接跳过该模型
      if (!breaker.allowRequest()) {
        console.warn(
          `[降级] ${model.name} 当前处于熔断状态，跳过。尝试下一个模型...`
        );
        continue;
      }

      console.log(`[尝试] 使用模型: ${model.name} (priority=${model.priority})`);

      try {
        // 发起请求（内部带重试）
        const response = await this.callModelWithRetry(model, messages, maxRetries);

        // 成功！记录并返回
        const elapsed = Date.now() - startTime;
        breaker.recordSuccess();
        console.log(
          `[成功] ${model.name} 响应成功，耗时 ${elapsed}ms`
        );

        // 存入缓存
        if (cacheKey) {
          this.responseCache.set(cacheKey, {
            response,
            timestamp: Date.now(),
          });
        }

        return response;
      } catch (error) {
        // 失败：记录到熔断器
        breaker.recordFailure();
        const aiError = classifyError(error, model.name);
        console.error(
          `[失败] ${model.name}: ${aiError.type} - ${aiError.message}`
        );

        // 如果是不可重试的错误（如 auth 错误），这个模型永久不可用
        // 但其他模型仍然可以尝试
        if (aiError.type === AIErrorType.AUTH_ERROR) {
          console.error(
            `[认证失败] ${model.name} 的 API Key 可能无效，将该模型从列表中移除。`
          );
          // 这里不做实际移除，只是跳过；生产环境可以发告警
        }

        // 继续尝试下一个模型
        continue;
      }
    }

    // 所有模型都失败了 → 尝试从缓存获取
    if (cacheKey && this.responseCache.has(cacheKey)) {
      const cached = this.responseCache.get(cacheKey)!;
      const age = Date.now() - cached.timestamp;
      if (age < this.cacheTTLMs) {
        console.warn(`[缓存兜底] 所有模型都失败，使用 ${(age / 1000).toFixed(0)}s 前的缓存响应`);
        return cached.response;
      }
    }

    // 最后的最后：返回兜底消息
    const elapsed = Date.now() - startTime;
    console.error(
      `[全部失败] 所有 ${this.models.length} 个模型都不可用（耗时 ${elapsed}ms），返回兜底消息。`
    );
    return this.fallbackMessage;
  }

  /**
   * 调用单个模型（内部带重试）
   */
  private async callModelWithRetry(
    model: ModelConfig,
    messages: { role: string; content: string }[],
    maxRetries: number
  ): Promise<string> {
    return withRetry(
      async () => {
        // 根据提供商调用不同的 API
        // 这里统一使用 OpenAI 兼容的接口格式（大多数提供商都支持）
        const response = await fetch(`${model.baseURL}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${model.apiKey}`,
          },
          body: JSON.stringify({
            model: model.name,
            messages,
            temperature: 0.7,
            max_tokens: 4096,
          }),
          // 设置超时：30 秒
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          // 构造一个类 SDK 错误对象，让 classifyError 能识别
          const errorBody = await response.text().catch(() => '');
          let errorData: any = {};
          try {
            errorData = JSON.parse(errorBody);
          } catch {
            errorData = { message: errorBody };
          }
          throw {
            status: response.status,
            message: errorData?.error?.message ?? errorData?.message ?? `HTTP ${response.status}`,
            code: errorData?.error?.code ?? errorData?.code,
            response: { headers: Object.fromEntries(response.headers.entries()) },
          };
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content ?? '';
      },
      {
        maxRetries,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        onRetry: (info) => {
          console.warn(
            `  [模型内重试] ${model.name} 第 ${info.attempt}/${info.maxRetries} 次, 等待 ${(info.delayMs / 1000).toFixed(1)}s`
          );
        },
      }
    );
  }

  /**
   * 获取所有模型的健康状态（用于监控面板）
   */
  getHealthStatus(): Array<{ model: string; circuit: string; failures: number }> {
    return this.models.map((m) => {
      const status = this.circuitBreakers.get(m.name)!.getStatus();
      return {
        model: m.name,
        circuit: status.state,
        failures: status.failureCount,
      };
    });
  }

  /**
   * 手动重置指定模型的熔断器
   */
  resetCircuitBreaker(modelName: string): void {
    const breaker = this.circuitBreakers.get(modelName);
    if (breaker) {
      // 创建新的熔断器替换旧的（重置所有状态）
      this.circuitBreakers.set(modelName, new CircuitBreaker(modelName, 3, 30_000));
      console.log(`[手动重置] ${modelName} 的熔断器已重置`);
    }
  }
}
```

---

## 5. 速率限制处理（Rate Limiting）

与其被动等待 429 错误再处理，不如主动控制请求速率。令牌桶（Token Bucket）是最经典的速率限制算法。

### 5.1 令牌桶速率限制器

```typescript
/**
 * 令牌桶速率限制器
 * 
 * 原理：
 * - 桶中有一个"令牌池"，以固定速率补充令牌
 * - 每次发起请求前，需要从桶中取出一个令牌
 * - 如果桶中有令牌，请求立即发出
 * - 如果桶中无令牌，请求等待直到新令牌生成
 * 
 * 优势：
 * - 允许一定的"突发"流量（桶的容量就是允许的最大突发）
 * - 长期来看严格限制平均速率
 * - 比固定间隔（如"每秒最多 N 个"）更灵活
 */
class TokenBucketRateLimiter {
  /** 当前桶中的令牌数量 */
  private tokens: number;
  /** 桶的最大容量（允许的最大突发请求数） */
  private capacity: number;
  /** 令牌填充速率：每秒生成多少个令牌 */
  private refillRate: number;
  /** 每次填充的时间间隔（毫秒） */
  private refillIntervalMs: number;
  /** 定时器 ID */
  private refillTimer: ReturnType<typeof setInterval> | null = null;
  /** 等待队列：{ resolve, requestedAt } */
  private waitingQueue: Array<{
    resolve: () => void;
    requestedAt: number;
  }> = [];
  /** 请求的最大排队时间（毫秒），超过则拒绝 */
  private maxQueueTimeMs: number;
  /** 统计信息 */
  private stats = {
    totalRequests: 0,
    acceptedRequests: 0,
    rejectedRequests: 0,
    queuedRequests: 0,
  };

  constructor(options: {
    /** 每秒允许多少个请求（requests per second） */
    requestsPerSecond: number;
    /** 桶的最大容量（允许的最大突发），默认等于 requestsPerSecond */
    capacity?: number;
    /** 排队最大等待时间（毫秒），默认 30 秒，超过则拒绝 */
    maxQueueTimeMs?: number;
  }) {
    this.capacity = options.capacity ?? options.requestsPerSecond;
    this.refillRate = options.requestsPerSecond;
    this.tokens = this.capacity; // 初始满桶
    this.refillIntervalMs = 100; // 每 100ms 补充一次
    this.maxQueueTimeMs = options.maxQueueTimeMs ?? 30_000;

    // 启动令牌补充定时器
    this.startRefill();

    console.log(
      `[令牌桶] 初始化完成: ${options.requestsPerSecond} req/s, 容量=${this.capacity}, ` +
      `最大排队=${this.maxQueueTimeMs / 1000}s`
    );
  }

  /**
   * 获取一个令牌（异步）
   * 如果当前没有令牌可用，会等待直到新令牌生成
   * 如果排队时间超过上限，会抛出错误
   * 
   * @returns 当令牌可用时 resolve
   */
  async acquire(): Promise<void> {
    this.stats.totalRequests++;

    // 如果当前有令牌，直接消耗一个
    if (this.tokens >= 1) {
      this.tokens--;
      this.stats.acceptedRequests++;
      return;
    }

    // 无令牌可用 → 进入等待队列
    this.stats.queuedRequests++;
    return new Promise<void>((resolve, reject) => {
      const entry = {
        resolve,
        requestedAt: Date.now(),
      };
      this.waitingQueue.push(entry);

      // 设置超时检查
      const checkTimeout = setInterval(() => {
        const elapsed = Date.now() - entry.requestedAt;
        if (elapsed > this.maxQueueTimeMs) {
          // 超时，从队列中移除
          const index = this.waitingQueue.indexOf(entry);
          if (index !== -1) {
            this.waitingQueue.splice(index, 1);
          }
          clearInterval(checkTimeout);
          this.stats.rejectedRequests++;
          reject(
            new AIError({
              message: `速率限制排队超时（等待了 ${(elapsed / 1000).toFixed(1)}s），请求被拒绝。`,
              type: AIErrorType.RATE_LIMIT,
              retryable: true,
            })
          );
        }
      }, 500);
    });
  }

  /**
   * 启动令牌补充
   * 每次补充: tokens = min(capacity, tokens + refillRate * (intervalMs / 1000))
   */
  private startRefill(): void {
    this.refillTimer = setInterval(() => {
      // 计算每次补充的令牌数
      const tokensPerTick = this.refillRate * (this.refillIntervalMs / 1000);
      this.tokens = Math.min(this.capacity, this.tokens + tokensPerTick);

      // 如果有等待的请求且令牌可用，放行
      while (this.waitingQueue.length > 0 && this.tokens >= 1) {
        const entry = this.waitingQueue.shift()!;
        this.tokens--;
        this.stats.acceptedRequests++;
        entry.resolve();
      }
    }, this.refillIntervalMs);

    // Node.js 中允许进程正常退出（不阻止退出）
    if (this.refillTimer && typeof this.refillTimer === 'object' && 'unref' in this.refillTimer) {
      (this.refillTimer as NodeJS.Timeout).unref();
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * 获取当前可用令牌数
   */
  getAvailableTokens(): number {
    return this.tokens;
  }

  /**
   * 获取等待队列长度
   */
  getQueueLength(): number {
    return this.waitingQueue.length;
  }

  /**
   * 停止令牌补充（清理资源）
   */
  destroy(): void {
    if (this.refillTimer) {
      clearInterval(this.refillTimer);
      this.refillTimer = null;
    }
    // 拒绝所有等待中的请求
    for (const entry of this.waitingQueue) {
      entry.resolve = () => {}; // 防止内存泄漏
    }
    this.waitingQueue = [];
  }
}

export { TokenBucketRateLimiter };
```

### 5.2 各模型提供商的速率限制参考值

```typescript
/**
 * 常见提供商的默认速率限制（2025年参考值，实际以官方文档为准）
 * 
 * 单位: Requests Per Minute (RPM) / Tokens Per Minute (TPM)
 * 
 * 注意：这些值随账号等级、付费计划变化，生产环境务必从环境变量读取
 */
const DEFAULT_RATE_LIMITS: Record<string, { rpm: number; tpm: number }> = {
  // OpenAI Tier 1 (免费用户初始等级)
  'gpt-4o':       { rpm: 500,   tpm: 30_000 },
  'gpt-4o-mini':  { rpm: 500,   tpm: 200_000 },
  'gpt-4-turbo':  { rpm: 500,   tpm: 30_000 },

  // Anthropic
  'claude-sonnet-4':  { rpm: 1000, tpm: 80_000 },
  'claude-haiku-3.5': { rpm: 1000, tpm: 100_000 },

  // DeepSeek
  'deepseek-v3':  { rpm: 500,   tpm: 50_000 },
  'deepseek-r1':  { rpm: 500,   tpm: 50_000 },

  // Google
  'gemini-2.5-pro': { rpm: 360, tpm: 120_000 },
};

/**
 * 根据模型的 RPM 限制创建对应的令牌桶速率限制器
 */
function createRateLimiterForModel(modelName: string): TokenBucketRateLimiter {
  const limit = DEFAULT_RATE_LIMITS[modelName];
  // RPM → RPS 转换
  const requestsPerSecond = limit ? limit.rpm / 60 : 5; // 没找到配置则默认 5 req/s
  return new TokenBucketRateLimiter({
    requestsPerSecond,
    capacity: Math.ceil(requestsPerSecond * 2), // 允许 2 秒的突发
  });
}
```

---

## 6. 完整的 RobustAIClient 类

将前面所有的组件（重试、降级、熔断、限流、日志）整合到一个类中，对外暴露一个简洁的 `chat()` 接口。

```typescript
/**
 * RobustAIClient —— 生产级 AI 调用客户端
 * 
 * 将以下所有能力整合到一个类中：
 * - 指数退避重试
 * - 模型自动降级
 * - 熔断器保护
 * - 令牌桶速率限制
 * - 错误日志与分类
 * - 缓存兜底
 * 
 * 使用方式：
 *   const client = new RobustAIClient({ ... });
 *   const reply = await client.chat([{ role: 'user', content: '你好' }]);
 */
class RobustAIClient {
  /** 多模型客户端（负责降级和熔断） */
  private multiModelClient: MultiModelClient;
  /** 每个模型的速率限制器 */
  private rateLimiters: Map<string, TokenBucketRateLimiter>;
  /** 是否已销毁 */
  private destroyed: boolean = false;
  /** 统计信息 */
  private stats = {
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    fallbackUsed: 0,
    cacheHits: 0,
  };

  constructor(config: {
    /** 模型配置列表 */
    models: ModelConfig[];
    /** 全局兜底消息 */
    fallbackMessage?: string;
    /** 缓存有效期（毫秒） */
    cacheTTLMs?: number;
    /** 默认最大重试次数 */
    defaultMaxRetries?: number;
  }) {
    // 初始化多模型客户端
    this.multiModelClient = new MultiModelClient(config.models, {
      fallbackMessage: config.fallbackMessage,
      cacheTTLMs: config.cacheTTLMs,
    });

    // 为每个模型创建速率限制器
    this.rateLimiters = new Map();
    for (const model of config.models) {
      this.rateLimiters.set(
        model.name,
        createRateLimiterForModel(model.name)
      );
    }

    console.log(
      `[RobustAIClient] 初始化完成。` +
      `${config.models.length} 个模型, 熔断阈值=3次, 默认重试=${config.defaultMaxRetries ?? 2}次`
    );
  }

  /**
   * 发送聊天请求（一站式入口）
   * 
   * 调用链路：
   * 1. 生成缓存键
   * 2. 检查缓存（可选）
   * 3. 令牌桶限流
   * 4. 依次尝试各模型（带熔断和退避重试）
   * 5. 所有模型失败 → 缓存兜底 → 兜底消息
   * 
   * @param messages - 消息数组
   * @param options  - 可选配置
   * @returns AI 的响应文本
   */
  async chat(
    messages: { role: string; content: string }[],
    options: {
      /** 自定义缓存键 */
      cacheKey?: string;
      /** 覆盖默认的最大重试次数 */
      maxRetries?: number;
      /** 是否使用缓存 */
      useCache?: boolean;
    } = {}
  ): Promise<{ content: string; modelUsed: string; fromCache: boolean }> {
    if (this.destroyed) {
      throw new AIError({
        message: 'RobustAIClient 已被销毁，无法继续使用。',
        type: AIErrorType.UNKNOWN,
        retryable: false,
      });
    }

    this.stats.totalCalls++;
    const startTime = Date.now();

    // 生成缓存键
    const cacheKey =
      options.cacheKey ??
      `chat:${this.hashMessages(messages)}`;

    try {
      // 获取当前活跃模型中优先级最高的那个，进行限流
      // 这里简化处理: 对所有限流器执行 acquire，确保不超限
      // 实际生产中可以只对当前尝试的模型限流
      const targetModel = this.multiModelClient.getHealthStatus()[0]?.model;
      if (targetModel) {
        const limiter = this.rateLimiters.get(targetModel);
        if (limiter) {
          await limiter.acquire();
        }
      }

      // 调用多模型客户端（内部处理降级和重试）
      const content = await this.multiModelClient.chat(messages, {
        cacheKey: options.useCache !== false ? cacheKey : undefined,
        maxRetries: options.maxRetries ?? 2,
      });

      const elapsed = Date.now() - startTime;

      // 区分是正常响应还是兜底响应
      const isFallback = content === this.multiModelClient['fallbackMessage']; // 访问私有字段仅用于判断
      if (isFallback) {
        this.stats.fallbackUsed++;
        this.stats.failedCalls++;
      } else {
        this.stats.successfulCalls++;
      }

      console.log(
        `[RobustAIClient] 请求完成, 耗时 ${elapsed}ms, ` +
        `成功=${this.stats.successfulCalls}, 失败=${this.stats.failedCalls}, ` +
        `兜底=${this.stats.fallbackUsed}`
      );

      return {
        content,
        modelUsed: targetModel ?? 'unknown',
        fromCache: false, // 暂时无法准确判断
      };
    } catch (error) {
      this.stats.failedCalls++;
      throw classifyError(error);
    }
  }

  /**
   * 流式聊天（示例，带基本错误处理）
   */
  async *chatStream(
    messages: { role: string; content: string }[],
    options: {
      maxRetries?: number;
    } = {}
  ): AsyncGenerator<string, void, unknown> {
    if (this.destroyed) {
      throw new AIError({
        message: 'RobustAIClient 已被销毁。',
        type: AIErrorType.UNKNOWN,
        retryable: false,
      });
    }

    try {
      // 简化处理：使用第一个可用模型做流式
      // 生产环境这里应该也走完整的降级链路
      const content = await this.multiModelClient.chat(messages, {
        maxRetries: options.maxRetries ?? 1,
      });

      // 模拟流式输出（实际应用需用各个 SDK 的原生流式接口）
      const chunks = content.split('');
      for (let i = 0; i < chunks.length; i++) {
        // 每 20ms 输出一个字符，模拟流式效果
        await sleep(20);
        yield chunks[i];
      }
    } catch (error) {
      yield '\n[流式输出中断: AI 服务暂不可用]';
    }
  }

  /**
   * 获取健康状态报告（供监控系统使用）
   */
  getHealthReport(): object {
    return {
      timestamp: new Date().toISOString(),
      stats: { ...this.stats },
      models: this.multiModelClient.getHealthStatus(),
      rateLimiters: Array.from(this.rateLimiters.entries()).map(([name, limiter]) => ({
        model: name,
        availableTokens: limiter.getAvailableTokens(),
        queueLength: limiter.getQueueLength(),
        stats: limiter.getStats(),
      })),
    };
  }

  /**
   * 简单哈希（用于生成缓存键）
   */
  private hashMessages(messages: { role: string; content: string }[]): string {
    const str = JSON.stringify(messages);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * 销毁客户端，释放所有资源
   */
  destroy(): void {
    this.destroyed = true;
    for (const limiter of this.rateLimiters.values()) {
      limiter.destroy();
    }
    this.rateLimiters.clear();
    console.log('[RobustAIClient] 已销毁，所有资源已释放。');
  }
}

export { RobustAIClient };
```

---

## 7. 使用示例

### 7.1 基础用法

```typescript
/**
 * 示例 1：最简单的用法 —— 创建一个客户端，发一条消息
 */
async function example1BasicUsage(): Promise<void> {
  // 初始化客户端
  const client = new RobustAIClient({
    models: [
      {
        name: 'gpt-4o',
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY!,
        baseURL: 'https://api.openai.com',
        priority: 1, // 最优先
      },
      {
        name: 'deepseek-v3',
        provider: 'deepseek',
        apiKey: process.env.DEEPSEEK_API_KEY!,
        baseURL: 'https://api.deepseek.com',
        priority: 2, // 次优先
      },
    ],
    fallbackMessage: '抱歉，AI 服务当前不可用，请稍后再试。',
    cacheTTLMs: 5 * 60 * 1000, // 缓存 5 分钟
  });

  // 发送请求 —— 所有错误处理都是透明的
  const result = await client.chat([
    { role: 'system', content: '你是一个有用的助手，请用中文回答。' },
    { role: 'user', content: '解释一下什么是"指数退避"算法。' },
  ]);

  console.log('=== 响应 ===');
  console.log(`使用的模型: ${result.modelUsed}`);
  console.log(`内容: ${result.content}`);
  console.log(`来自缓存: ${result.fromCache}`);

  // 查看健康状态
  console.log('\n=== 健康报告 ===');
  console.log(JSON.stringify(client.getHealthReport(), null, 2));

  // 清理资源
  client.destroy();
}
```

### 7.2 模拟各种错误场景

```typescript
/**
 * 示例 2：模拟各种错误并观察客户端如何优雅处理
 */
async function example2ErrorScenarios(): Promise<void> {
  console.log('=== 错误场景模拟 ===\n');

  // ---- 场景 A: 模拟 429 速率限制 ----
  console.log('--- 场景 A: 模拟 429 速率限制 ---');
  try {
    await withRetry(
      async () => {
        // 模拟抛出 429 错误
        throw {
          status: 429,
          message: 'Rate limit exceeded. Please slow down.',
          response: {
            headers: { 'retry-after': '5' }, // 服务端建议等 5 秒
          },
        };
      },
      {
        maxRetries: 3,
        onRetry: (info) => {
          console.log(
            `  重试回调: 第 ${info.attempt} 次, 等待 ${(info.delayMs / 1000).toFixed(1)}s ` +
            `(错误: ${info.error.type})`
          );
        },
      }
    );
    console.log('  (不会到达这里，因为模拟函数始终失败)');
  } catch (error) {
    const aiError = classifyError(error);
    console.log(`  最终失败: ${aiError.type} - ${aiError.message}\n`);
  }

  // ---- 场景 B: 模拟超时 ----
  console.log('--- 场景 B: 模拟请求超时 ---');
  try {
    await withRetry(
      async () => {
        // 模拟一个超时的请求（2秒后还没返回）
        await new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timed out after 30s')), 100)
        );
        return 'success';
      },
      {
        maxRetries: 2,
        baseDelayMs: 500,
        onRetry: (info) => {
          console.log(
            `  重试回调: 第 ${info.attempt} 次, 等待 ${(info.delayMs / 1000).toFixed(1)}s`
          );
        },
      }
    );
  } catch (error) {
    const aiError = classifyError(error);
    console.log(`  最终失败: ${aiError.type} - ${aiError.message}\n`);
  }

  // ---- 场景 C: 模拟不可重试的错误（认证失败） ----
  console.log('--- 场景 C: 模拟 401 认证错误（不可重试） ---');
  try {
    await withRetry(
      async () => {
        throw {
          status: 401,
          message: 'Invalid API key. Please check your credentials.',
        };
      },
      {
        maxRetries: 3, // 虽然设置了 3 次重试
        onRetry: () => console.log('  (这个回调不会被触发，因为 401 不可重试)'),
      }
    );
  } catch (error) {
    const aiError = classifyError(error);
    console.log(`  立即失败（不重试）: ${aiError.type} - ${aiError.message}\n`);
  }

  // ---- 场景 D: 令牌桶速率限制演示 ----
  console.log('--- 场景 D: 令牌桶速率限制演示 ---');
  const limiter = new TokenBucketRateLimiter({
    requestsPerSecond: 2, // 每秒只允许 2 个请求
    capacity: 3,          // 最大突发 3 个
    maxQueueTimeMs: 5000, // 最多排队 5 秒
  });

  console.log('  发送 10 个请求（限速 2 req/s）...');
  const startTime = Date.now();

  const tasks = Array.from({ length: 10 }, (_, i) =>
    limiter.acquire().then(() => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  请求 #${i + 1} 在 ${elapsed}s 时获得许可`);
    })
  );

  await Promise.all(tasks);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  全部完成！总耗时: ${totalTime}s`);
  console.log(`  统计: ${JSON.stringify(limiter.getStats())}\n`);

  limiter.destroy();
}
```

### 7.3 完整应用示例

```typescript
/**
 * 示例 3：一个使用 RobustAIClient 的实际应用
 * 
 * 场景：批量翻译任务，需要对大量文本调用 AI 翻译。
 * 这个例子展示了如何在真实场景中使用所有的错误处理能力。
 */
async function example3RealWorldApp(): Promise<void> {
  console.log('=== 真实应用示例: 批量翻译任务 ===\n');

  // 创建客户端
  const client = new RobustAIClient({
    models: [
      {
        name: 'gpt-4o-mini',
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY ?? 'sk-demo-key',
        baseURL: 'https://api.openai.com',
        priority: 1,
      },
      {
        name: 'deepseek-v3',
        provider: 'deepseek',
        apiKey: process.env.DEEPSEEK_API_KEY ?? 'sk-demo-key',
        baseURL: 'https://api.deepseek.com',
        priority: 2,
      },
    ],
    fallbackMessage: '[翻译失败]',
    cacheTTLMs: 10 * 60 * 1000,
  });

  // 模拟一批需要翻译的文本
  const textsToTranslate: string[] = [
    'Hello, how are you today?',
    'The quick brown fox jumps over the lazy dog.',
    'Artificial intelligence is transforming every industry.',
    'Please handle this request carefully.',
    'Thank you for your patience and understanding.',
  ];

  console.log(`需要翻译 ${textsToTranslate.length} 条文本\n`);

  const results: Array<{ original: string; translated: string; success: boolean }> = [];

  // 逐条翻译（如果需要并发，加上限流器控制并发数）
  for (const [index, text] of textsToTranslate.entries()) {
    console.log(`[${index + 1}/${textsToTranslate.length}] 翻译中: "${text}"`);

    try {
      const result = await client.chat(
        [
          {
            role: 'system',
            content: '你是专业的中英翻译。请将下面的英文翻译成中文。只输出翻译结果，不要加任何解释。',
          },
          { role: 'user', content: text },
        ],
        { cacheKey: `translate:${text}`, useCache: true }
      );

      results.push({
        original: text,
        translated: result.content,
        success: !result.content.includes('翻译失败'),
      });

      console.log(`  → ${result.content}`);
    } catch (error) {
      const aiError = classifyError(error);
      console.error(`  ✗ 翻译失败: ${aiError.type}`);
      results.push({
        original: text,
        translated: '[错误]',
        success: false,
      });
    }
  }

  // 输出统计
  const successCount = results.filter((r) => r.success).length;
  console.log('\n=== 翻译任务完成 ===');
  console.log(`成功: ${successCount}/${textsToTranslate.length}`);
  console.log(`失败: ${results.length - successCount}/${textsToTranslate.length}`);

  // 打印健康报告
  console.log('\n=== 系统健康状态 ===');
  const healthReport = client.getHealthReport() as any;
  console.log(`总调用: ${healthReport.stats.totalCalls}`);
  console.log(`成功: ${healthReport.stats.successfulCalls}`);
  console.log(`失败: ${healthReport.stats.failedCalls}`);
  console.log(`兜底: ${healthReport.stats.fallbackUsed}`);
  console.log(`缓存命中: ${healthReport.stats.cacheHits}`);
  console.log('模型状态:');
  for (const m of healthReport.models) {
    console.log(`  ${m.model}: 熔断器=${m.circuit}, 失败计数=${m.failures}`);
  }

  // 清理
  client.destroy();
}
```

### 7.4 运行所有示例

```typescript
/**
 * 运行所有演示示例
 * 
 * 设置环境变量后运行：
 *   export OPENAI_API_KEY=sk-xxx
 *   export DEEPSEEK_API_KEY=sk-xxx
 *   npx ts-node 23-error-handling-demo.ts
 */
async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   AI API 错误处理与重试 —— 完整演示          ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // 演示退避时间线
  console.log('--- 退避时间线 ---');
  demoBackoffTimeline();
  console.log('');

  // 演示错误场景
  await example2ErrorScenarios();

  // 注意：以下示例需要真实的 API Key 才能完整运行
  // 如果只是学习代码结构，错误场景演示已经足够
  console.log('提示：要运行真实 API 调用的示例，请设置环境变量 OPENAI_API_KEY 和 DEEPSEEK_API_KEY');
}

// 如果直接运行本文件，执行 main()
if (require.main === module) {
  main().catch((error) => {
    console.error('演示失败:', error);
    process.exit(1);
  });
}
```

---

## 总结

一套完整的 AI API 错误处理方案包含以下层次：

```
                          ┌─────────────────────────┐
                          │   你的应用代码            │
                          │   client.chat(messages)  │
                          └───────────┬─────────────┘
                                      │
                          ┌───────────▼─────────────┐
                  第1层   │   速率限制（令牌桶）      │  ← 主动控制，预防 429
                          └───────────┬─────────────┘
                                      │
                          ┌───────────▼─────────────┐
                  第2层   │   熔断器检查              │  ← 跳过已知不健康的模型
                          └───────────┬─────────────┘
                                      │
                          ┌───────────▼─────────────┐
                  第3层   │   指数退避重试            │  ← 可恢复错误的自动恢复
                          └───────────┬─────────────┘
                                      │
                          ┌───────────▼─────────────┐
                  第4层   │   模型降级链              │  ← 自动切换到备用模型
                          └───────────┬─────────────┘
                                      │
                          ┌───────────▼─────────────┐
                  第5层   │   缓存兜底                │  ← 返回历史响应
                          └───────────┬─────────────┘
                                      │
                          ┌───────────▼─────────────┐
                  第6层   │   固定兜底消息            │  ← 最后的最后
                          └─────────────────────────┘
```

**关键要点：**

1. **分类先行**：所有错误必须先经过 `classifyError()` 分类，明确哪些可重试、哪些不行
2. **退避要带抖动**：不加抖动的指数退避会在短时间内产生大量同步重试，造成"惊群效应"
3. **熔断保护**：连续失败的模型应该被临时隔离，给它恢复时间，也避免浪费你的请求配额
4. **尊重服务端**：`Retry-After` 头的优先级高于你的计算值
5. **永远有兜底**：缓存兜底 + 固定兜底消息，确保应用不会因为 AI 不可用而彻底崩溃
6. **可观测性**：记录每次错误、每次重试、每次降级，出了问题才知道发生了什么

将这套方案放入你的 AI 应用，它将从"碰运气"变成"可靠的工程系统"。

---

> **下一章建议**: [24. AI 应用监控与可观测性] — 学习了错误处理后，下一步是建立完善的监控体系，让你在问题发生之前就发现它。
