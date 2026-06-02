// 接收用户目标，调用 Planner 拆解任务，再把任务分发给对应 Agent，汇总结果
import type { BaseAgent } from "../agent/base-agent.js";
import { PlannerAgent } from "../agent/planner-agent.js";
import type { AgentName, Session, SubTask } from "../type/type.js";

// 引入上下文管理器。
import type { ContextManager } from "./context-manager.js";
// 引入会话管理器。
import type { SessionManager } from "./session-manager.js";

/**
 * 智能体协调器。
 * 负责接收用户目标，调用 Planner 拆解任务，再把任务分发给对应 Agent，汇总结果。
 */
export class Orchestrator {
  /** 智能体协调器名称。 */
  readonly name: AgentName = "orchestrator";
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly contextManager: ContextManager,
    private readonly planner: PlannerAgent,
    private readonly agents: Map<AgentName, BaseAgent>,
  ) {}

  //   执行用户目标
  async runGoal(session: Session, goal: string) {
    // 先把用户输入写入会话历史
    await this.sessionManager.appendMessage(session.sessionId, {
      role: "user",
      agentName: "orchestrator",
      content: goal,
    });

    // 构建当前可见上下文
    const context = this.contextManager
      .buildContext(session)
      .map((message) => `[${message.agentName}] ${message.content}`)
      .join("\n");

    //   拆解任务
    const subTasks = await this.planner.plan(goal);
    // 收集最终展示
    const result: string[] = [];
    // 先输出执行计划。
    result.push("执行计划：");
    for (const task of subTasks) {
      result.push(`- ${task.title} -> ${task.assignedTo}`);
    }
    // 先按顺序执行任务 mvp简单实现
    for (const task of subTasks) {
      task.status = "running";
      const agent = this.agents.get(task.assignedTo);
      // 如果 Agent 不存在，则标记任务失败并继续处理后续任务。
      if (!agent) {
        task.status = "failed";

        result.push(`任务失败：${task.title}，未找到 Agent ${task.assignedTo}`);
        continue;
      }

      const agentContext = `用户原始目标：${goal}\n\n上下文：${context}`;
      const res = await agent.run(task, agentContext);

      task.status = res.success ? "success" : "failed";
      // 把当前任务结果追加到最终输出中。
      result.push(`\n## ${task.title}`);
      result.push(res.content);
      // 将子agent输出写入会话历史
      await this.sessionManager.appendMessage(session.sessionId, {
        role: "agent",
        agentName: task.assignedTo,
        content: res.content,
        metadata: {
          taskId: task.id,
          status: task.status,
        },
      });
    }
    // 最后汇总所有任务结果
    const summary = result.join("\n任务执行完成。");

    // 把最终回答写入会话。
    await this.sessionManager.appendMessage(session.sessionId, {
      role: "assistant",
      agentName: "orchestrator",
      content: summary,
    });

    // 返回最终回答给 CLI 或 API。
    return summary;
  }
}
