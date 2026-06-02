// 引入 Agent 基类和结果类型。
import { BaseAgent, type AgentResult } from "./base-agent.js";

import type { AgentName, SubTask } from "../type/type.js";

export class ReviewerAgent extends BaseAgent {
  readonly name: AgentName = "reviewer";
  async run(task: SubTask, context: string): Promise<AgentResult> {
    // 调用 LLM 生成审查意见。
    const response = await this.llm.generate([
      {
        role: "system",
        content:
          "你是 Reviewer Agent。请优先检查 bug、风险、遗漏、测试缺口。输出简洁审查意见。",
      },
      {
        role: "user",
        content: `任务：${task.description}\n\n上下文：${context}`,
      },
    ]);
    return {
      success: true,
      content: response,
    };
  }
}
