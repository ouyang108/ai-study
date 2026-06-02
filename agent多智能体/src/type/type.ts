/**
 * Agent 名称枚举。
 * 用来标识系统里的主控 Agent 和各类专业子 Agent。
 */
export type AgentName =
  /** 主控编排器，负责接收用户目标、拆解任务、调度子 Agent、汇总结果。 */
  | "orchestrator"
  /** 规划 Agent，负责把用户目标拆解为可执行的子任务列表。 */
  | "planner"
  /** 执行 Agent，负责调用工具完成文件操作、命令执行、代码生成等动作。 */
  | "executor"
  /** 审查 Agent，负责检查执行结果的质量、风险、遗漏和测试缺口。 */
  | "reviewer"
  /** 研究 Agent，负责资料检索、信息整理、假设验证和上下文补充。 */
  | "researcher";

/**
 * 会话消息角色。
 * 用来区分消息来源和消息在上下文里的语义。
 */
export type MessageRole =
  /** 用户输入的自然语言消息。 */
  | "user"
  /** 系统最终返回给用户的助手消息，通常由 orchestrator 汇总生成。 */
  | "assistant"
  /** 系统级消息，例如历史摘要、规则、运行环境说明。 */
  | "system"
  /** 子 Agent 产生的中间消息或执行结果。 */
  | "agent";

/**
 * 子任务状态。
 * 用来跟踪每个任务从创建到完成或失败的生命周期。
 */
export type TaskStatus =
  /** 已创建但还未开始执行。 */
  | "pending"
  /** 正在执行中。 */
  | "running"
  /** 执行成功。 */
  | "success"
  /** 执行失败，通常需要重试、降级或人工介入。 */
  | "failed"
  /** 被用户或系统取消。 */
  | "cancelled";

/**
 * 会话中的单条消息。
 * 所有用户输入、Agent 输出、系统摘要都会统一保存成这个结构。
 */
export interface SessionMessage {
  /** 消息唯一 ID，建议使用 UUID，方便追踪和引用。 */
  id: string;

  /** 消息角色，用来区分 user、assistant、system、agent。 */
  role: MessageRole;

  /** 产生这条消息的 Agent 名称。用户消息通常记为 orchestrator。 */
  agentName: AgentName;

  /** 消息正文内容。 */
  content: string;

  /** 是否固定保留在上下文中。被 pin 的消息不会被摘要压缩或滑动窗口裁剪。 */
  pinned?: boolean;

  /** 消息附加信息，例如 taskId、toolCalls、token 用量、错误信息等。 */
  metadata?: Record<string, unknown>;

  /** 消息创建时间，使用 ISO8601 字符串。 */
  createdAt: string;
}

/**
 * 会话上下文。
 * 保存当前会话运行所需的工作目录、环境变量、业务变量和历史摘要。
 */
export interface SessionContext {
  /** 当前会话的工作目录。所有文件操作默认限制在这个目录内。 */
  workingDir: string;

  /** 会话级环境变量。注意不要把 API Key 等敏感信息直接写入会话文件。 */
  environment: Record<string, string>;

  /** 用户或系统设置的自定义变量，例如项目名称、技术栈、偏好配置。 */
  customVars: Record<string, unknown>;

  /** 被压缩后的历史对话摘要，用于长会话上下文管理。 */
  summary?: string;
}

/**
 * 一个完整会话。
 * 会话是多轮对话、任务执行、上下文恢复和审计的基本单位。
 */
export interface Session {
  /** 会话唯一 ID，建议使用 UUID。 */
  sessionId: string;

  /** 会话标题，可以由用户指定，也可以由系统根据首条任务自动生成。 */
  title: string;

  /** 会话创建时间，使用 ISO8601 字符串。 */
  createdAt: string;

  /** 会话最后更新时间，任何消息或上下文变化都应更新此字段。 */
  updatedAt: string;

  /** 会话消息列表，按时间顺序保存用户、系统和 Agent 消息。 */
  messages: SessionMessage[];

  /** 会话上下文信息。 */
  context: SessionContext;
}

/**
 * Agent 之间通过消息总线传递的事件。
 * Orchestrator 可以监听所有事件，子 Agent 也可以订阅指定事件。
 */
export interface AgentEvent {
  /** 事件唯一 ID，建议使用 UUID。 */
  id: string;

  /** 事件发送方 Agent。 */
  fromAgent: AgentName;

  /** 事件接收方 Agent；all 表示广播给所有监听者。 */
  toAgent: AgentName | "all";

  /**
   * 事件类型。
   * task 表示任务派发，result 表示结果返回，log 表示过程日志，
   * error 表示错误事件，tool_call 表示工具调用事件。
   */
  type: "task" | "result" | "log" | "error" | "tool_call";

  /** 事件载荷。不同事件类型可以携带不同结构的数据。 */
  payload: unknown;

  /** 事件发生时间，使用 ISO8601 字符串。 */
  timestamp: string;
}

/**
 * Planner 拆解出的子任务。
 * Orchestrator 会根据 assignedTo 把子任务分发给对应 Agent。
 */
export interface SubTask {
  /** 子任务唯一 ID，建议使用 UUID。 */
  id: string;

  /** 子任务标题，用于列表展示和日志记录。 */
  title: string;

  /** 子任务详细描述，说明要做什么、输入是什么、期望输出是什么。 */
  description: string;

  /** 负责执行该子任务的 Agent。 */
  assignedTo: AgentName;

  /** 当前任务依赖的其他子任务 ID。依赖完成后才能执行当前任务。 */
  dependsOn: string[];

  /** 当前子任务状态。 */
  status: TaskStatus;
}

/**
 * 工具调用描述。
 * 模型或 Agent 不直接执行副作用操作，而是生成 ToolCall 交给工具注册中心执行。
 */
export interface ToolCall {
  /** 工具名称，必须能在 ToolRegistry 中找到。 */
  toolName: string;

  /** 工具参数。执行前应使用 schema 校验参数类型和必填字段。 */
  args: Record<string, unknown>;
}

/**
 * 撤销信息。
 * 所有有副作用的工具调用都应尽量返回 undoInfo，方便实现 /undo。
 */
export interface UndoInfo {
  /**
   * 撤销方式。
   * reverse 表示通过反向工具调用撤销；
   * snapshot 表示通过快照恢复；
   * custom 表示由工具或插件自定义撤销逻辑。
   */
  action: "reverse" | "snapshot" | "custom";

  /** 反向工具调用。例如 write_file 的反向操作可以是 delete_file 或恢复旧内容。 */
  reverseCall?: ToolCall;

  /** 快照文件或快照目录路径，通常用于任务级或会话级撤销。 */
  snapshotPath?: string;

  /** 额外撤销元数据，例如旧文件哈希、任务 ID、操作者、变更摘要等。 */
  metadata?: Record<string, unknown>;
}

/**
 * 工具执行结果。
 * 所有工具都统一返回这个结构，方便 Agent、Orchestrator、UndoManager 处理。
 */
export interface ToolResult<T = unknown> {
  /** 工具是否执行成功。 */
  success: boolean;

  /** 工具成功时返回的数据。泛型 T 表示具体数据类型。 */
  data?: T;

  /** 工具失败时返回的错误信息。 */
  error?: string;

  /** 可选撤销信息。只有有副作用并且可撤销的工具需要返回。 */
  undoInfo?: UndoInfo;
}

/**
 * 工具定义。
 * ToolRegistry 通过这个结构统一管理内置工具和插件工具。
 */
export interface ToolDefinition {
  /** 工具唯一名称，例如 read_file、write_file、run_shell。 */
  name: string;

  /** 工具描述，会提供给 Agent 或 LLM 作为工具选择依据。 */
  description: string;

  /** 参数 schema。推荐使用 Zod schema，也可以使用 JSON Schema。 */
  parameters: unknown;

  /** 是否有副作用。文件写入、删除、命令执行、网络写操作都属于有副作用。 */
  sideEffect: boolean;

  /** 工具执行函数。入参是已校验或待校验的参数，返回统一 ToolResult。 */
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}
