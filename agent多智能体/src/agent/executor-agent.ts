// 根据任务调用工具
// 生成工具操作记录 ID。
import { randomUUID } from "node:crypto";
import { BaseAgent, type AgentResult } from "./base-agent";
import type { AgentName, SubTask } from "../type/type";
import type { ToolRegistry } from "../tools/tool-registry";
import type { UndoManager } from "../core/undo-manager";

/**
 * 执行 Agent。
 * 负责把任务转换成工具调用，并记录可撤销操作。
 */
export class ExecutorAgent extends BaseAgent {
  /** 固定 Agent 名称。 */
  readonly name: AgentName = "executor";
  /**
   * @param llm LLM Provider。
   * @param bus 消息总线。
   * @param toolRegistry 工具注册中心。
   * @param undoManager 撤销管理器。
   */
  //  ConstructorParameters 提取一个类（Class）的构造函数（constructor）中所有参数的类型，并以元组（Tuple）的形式返回
  constructor(
    llm: ConstructorParameters<typeof BaseAgent>[0],
    bus: ConstructorParameters<typeof BaseAgent>[1],
    private toolRegistry: ToolRegistry,
    private undoManager: UndoManager,
  ) {
    super(llm, bus);
  }
  //   执行一个子任务
  async run(task: SubTask, content: string): Promise<AgentResult> {
    this.log(`Executor received task: ${task.title}`);
    // 目前先使用正则表达式进行匹配
    const executableText = `${task.description}\n${content}`;
    const match = executableText.match(/创建文件\s+(.+?)\s+内容\s+([^\r\n]+)/);
    if (match) {
      // 提取路径和内容。

      const [, rawPath, rawContent] = match;
      const path = rawPath.trim();
      const fileContent = rawContent.trim();
      // 调用文件写入工具。
      const result = await this.toolRegistry.call("write_file", {
        path,
        content: fileContent,
      });
      //   记录可撤销操作
      this.undoManager.record({
        id: randomUUID(),
        toolCall: { toolName: "write_file", args: { path, content: fileContent } },
        result,
        undoInfo: result.undoInfo,
        createdAt: new Date().toISOString(),
      });
      // 返回执行结果给 Orchestrator。
      return {
        success: result.success,
        content: result.success
          ? `已创建文件：${path}`
          : `创建失败：${result.error}`,
        metadata: { result },
      };
    }
    // 如果没有匹配到可执行工具，则让 LLM 给出执行建议。
    const response = await this.llm.generate([
      {
        role: "system",
        content:
          "你是执行 Agent。当前没有匹配到可执行工具时，请给出下一步执行建议。",
      },
      {
        role: "user",
        content: `${task.description}\n\n上下文：${content}`,
      },
    ]);
    return {
      success: true,
      content: response,
    };
  }
}
