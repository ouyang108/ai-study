// 所有子agent都继承自这个类，统一接受任务，访问llm，发布事件
import type { MessageBus } from "../core/message-bus";
import type { AgentName, SubTask } from "../type/type";

import type { LlmProvider } from "../llm/llm-provider";

/** Agent 执行结果。 */
export interface AgentResult {
  /** 是否执行成功。 */
  success: boolean;
  /** 给 Orchestrator 或用户看的文本结果。 */
  content: string;
  /** 附加信息，例如任务列表、工具结果、评分等。 */
  metadata?: Record<string, unknown>;
}

export abstract class BaseAgent {
  abstract readonly name: AgentName;
  constructor(
    protected readonly llm: LlmProvider,
    protected readonly bus: MessageBus,
  ) {}
  //   子任务
  abstract run(task: SubTask, context: string): Promise<AgentResult>;

  protected log(content: string) {
    this.bus.publish({
      type: "log",
      payload: { content },
      fromAgent: this.name,
      toAgent: "orchestrator", //主控编排器
    });
  }
}
