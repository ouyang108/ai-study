#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
// 路径工具。
import { join, resolve } from "node:path";
// 核心模块。
import { MessageBus } from "../core/message-bus";
import { SessionManager } from "../core/session-manager";
import { ContextManager } from "../core/context-manager";
import { UndoManager } from "../core/undo-manager";
import { Orchestrator } from "../core/orchestrator";
// 工具系统。
import { ToolRegistry } from "../tools/tool-registry";
import { createFileTools } from "../tools/file-tools";
import { createShellTools } from "../tools/shell-tools";
// LLM Provider。
// import { MockProvider } from "../llm/mock-provider.js";
import { OpenAIProvider } from "../llm/openai-provider";
// 内置 Agent。
import { PlannerAgent } from "../agent/planner-agent";
import { ExecutorAgent } from "../agent/executor-agent";
import { ReviewerAgent } from "../agent/reviewer-agent";
import { ResearcherAgent } from "../agent/researcher-agent";

// 当前项目根目录，CLI 在哪个目录执行，哪个目录就是 rootDir。
const rootDir = resolve(process.cwd());
// 数据目录，用于保存会话和插件元数据。
const dataDir = join(rootDir, "data");
// 工作目录，文件工具只能在这里读写。
const workspaceDir = join(rootDir, "workspace");

// 创建会话管理器。
const sessionManager = new SessionManager(join(dataDir, "sessions"));
// 创建上下文管理器，最多注入最近 20 条消息。
const contextManager = new ContextManager({ maxMessages: 20 });
// 创建消息总线。
const bus = new MessageBus();
// 创建撤销管理器。
const undoManager = new UndoManager();
// 创建工具注册中心。
const toolRegistry = new ToolRegistry();
// 注册内置文件工具。
for (const tool of createFileTools(workspaceDir)) {
  toolRegistry.register(tool);
}
// 注册内置 Shell 工具。
for (const tool of createShellTools(workspaceDir)) {
  toolRegistry.register(tool);
}
const llm = new OpenAIProvider();
// 创建内置 Agent 实例。
const planner = new PlannerAgent(llm, bus);
const executor = new ExecutorAgent(llm, bus, toolRegistry, undoManager);
const reviewer = new ReviewerAgent(llm, bus);
const researcher = new ResearcherAgent(llm, bus);

// 创建主控编排器，并注册可调度的 Agent。
const orchestrator = new Orchestrator(
  sessionManager,
  contextManager,
  planner,
  new Map([
    ["planner", planner],
    ["executor", executor],
    ["reviewer", reviewer],
    ["researcher", researcher],
  ]),
);

// 创建 CLI 程序。
const program = new Command();
// 设置 CLI 基本信息。
program
  .name("mao")
  .description("Multi-Agent Orchestrator CLI")
  .version("0.1.0");

// 新建会话命令。
program
  .command("session:new")
  .argument("[title]", "session title", "新会话")
  .action(async (title) => {
    // 创建会话并打印 session_id。
    const session = await sessionManager.createSession(title, workspaceDir);
    console.log(`session_id=${session.sessionId}`);
  });
// 列出会话命令。
program.command("session:list").action(async () => {
  // 加载所有会话并逐行输出。
  const sessions = await sessionManager.listSessions();
  for (const session of sessions) {
    console.log(`${session.sessionId}  ${session.title}  ${session.updatedAt}`);
  }
});
// 提交任务命令。
program
  .command("task")
  .argument("<goal>", "natural language task")
  .option("-s, --session <sessionId>", "session id")
  .action(async (goal, options) => {
    // 如果传了 sessionId 就加载已有会话，否则创建临时会话。
    const session = options.session
      ? await sessionManager.load(options.session)
      : await sessionManager.createSession("临时任务", workspaceDir);

    // 交给 Orchestrator 执行目标。
    const result = await orchestrator.runGoal(session, goal);
    // 输出最终结果。
    console.log(result);
  });

// 列出工具命令。
program.command("tools:list").action(() => {
  // 展示工具名、副作用标记和描述。
  for (const tool of toolRegistry.list()) {
    console.log(
      `${tool.name}  sideEffect=${tool.sideEffect}  ${tool.description}`,
    );
  }
});

// 撤销最近一次可撤销操作。
program.command("undo").action(async () => {
  // 调用 UndoManager 执行反向工具调用。
  const result = await undoManager.undoLast(toolRegistry);
  // 打印撤销结果。
  console.log(JSON.stringify(result, null, 2));
});

// 启动 CLI 参数解析。
program.parseAsync();
