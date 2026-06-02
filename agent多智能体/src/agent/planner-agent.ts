// 将用户目标拆解成子任务

// 用 UUID 生成子任务 ID。
import { randomUUID } from "node:crypto";
// Zod 用于校验 LLM 输出的计划结构。
import { z } from "zod";
import { BaseAgent, type AgentResult } from "./base-agent";
import type { AgentName, SubTask } from "../type/type";

const PlanSchema = z.array(
  z.object({
    title: z.string(),

    description: z.string(),
    assignedTo: z.enum(["researcher", "executor", "reviewer"]),
  }),
);

// 任务规划agent
export class PlannerAgent extends BaseAgent {
  /** 固定 Agent 名称。 */
  readonly name: AgentName = "planner";
  //   根据用户生成子任务
  async plan(global: string): Promise<SubTask[]> {
    const prompt = `你是任务规划 Agent。请把用户目标拆成 3 到 5 个子任务，输出 JSON 数组，字段为 title、description、assignedTo。assignedTo 只能是 researcher/executor/reviewer。`;
    const raw = await this.llm.generate([
      { role: "system", content: prompt },
      { role: "user", content: global },
    ]);
    try {
      const parsed = PlanSchema.parse(JSON.parse(raw));

      return parsed.map((item) => ({
        id: randomUUID(),
        title: item.title,
        description: item.description,
        assignedTo: item.assignedTo,
        dependsOn: [],
        status: "pending",
      }));
    } catch (error) {
      // LLM 没有返回合法 JSON 时，使用兜底计划，保证系统流程仍然可运行。
      return [
        {
          id: randomUUID(),
          title: "理解需求并制定方案",
          description: global,
          assignedTo: "researcher",
          dependsOn: [],
          status: "pending",
        },
        {
          id: randomUUID(),
          title: "执行主要实现",
          description: "根据方案进行文件、命令或代码层面的执行。",
          assignedTo: "executor",
          dependsOn: [],
          status: "pending",
        },
        {
          id: randomUUID(),
          title: "审查结果",
          description: "检查产出质量、风险、遗漏和后续建议。",
          assignedTo: "reviewer",
          dependsOn: [],
          status: "pending",
        },
      ];
    }
  }
  async run(task: SubTask, context: string): Promise<AgentResult> {
    // 把当前任务和上下文一起传给 plan。
    const tasks = await this.plan(`${task.description}\n\n上下文：${context}`);
    return {
      success: true,
      content: JSON.stringify(tasks, null, 2),
      metadata: { tasks },
    };
  }
}
