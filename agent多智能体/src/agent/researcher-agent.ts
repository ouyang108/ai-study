// 先做本地资料整理和问题澄清。以后可接 Web Search、企业知识库、MCP 搜索工具
import { BaseAgent, type AgentResult } from "./base-agent.js";
import type { AgentName, SubTask } from "../type/type.js";
/**
 * 研究 Agent。
 * 负责整理资料、分析未知项、提出需要验证的假设。
 */
export class ResearcherAgent extends BaseAgent {
  /** 固定 Agent 名称。 */
  readonly name: AgentName = "researcher";

  /** 执行研究任务。 */
  async run(task: SubTask, context: string): Promise<AgentResult> {
    // 调用 LLM 生成研究结果；要求不要编造来源。
    const response = await this.llm.generate([
      {
        role: "system",
        content:
          "你是 Researcher Agent。请整理已知信息、未知问题、需要验证的假设，不要编造来源。",
      },
      {
        role: "user",
        content: `研究任务：${task.description}\n\n上下文：${context}`,
      },
    ]);

    // 返回研究结果。
    return {
      success: true,
      content: response,
    };
  }
}
