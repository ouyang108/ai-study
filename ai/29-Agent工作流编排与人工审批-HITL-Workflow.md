# Agent 工作流编排与人工审批完整案例

很多 AI 系统不是“要不要用 Agent”的问题，而是：

- 哪些步骤必须确定性执行
- 哪些步骤可以交给模型建议
- 哪些高风险动作必须人工审批
- 一旦失败，怎么可恢复、可追踪、可重放

这篇给一个完整 TypeScript 案例：**客户退款工作流**。

工作流原则：

1. AI 只负责分类、总结、建议，不直接做高风险决策。
2. 低风险单子自动处理，高风险单子进入人工审批。
3. 每一步都写入状态文件，方便重放和审计。
4. 使用 OpenAI-compatible Chat Completions，兼容 DeepSeek、Ollama、vLLM 等。

## 1. 适用场景

- 客服退款
- 内容审核
- 采购审批
- 工单分流
- 法务 / 财务 / 安全高风险流程

## 2. 项目结构

```text
hitl-workflow-demo/
├── .env
├── package.json
├── tsconfig.json
└── src/
    └── workflow.ts
```

## 3. 安装依赖

```bash
npm init -y
npm install openai zod dotenv
npm install -D typescript tsx @types/node
```

## 4. 环境变量

```bash
# .env
DEEPSEEK_API_KEY=sk-your-key
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
```

## 5. 完整代码

```typescript
// src/workflow.ts
import OpenAI from "openai";
import { z } from "zod";
import "dotenv/config";
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY,
  baseURL: process.env.LLM_BASE_URL ?? "https://api.deepseek.com/v1",
});

const model = process.env.LLM_MODEL ?? "deepseek-chat";
const DATA_DIR = "./data";
const CASES_FILE = `${DATA_DIR}/cases.json`;
const AUDIT_FILE = `${DATA_DIR}/audit.log`;

const TicketSchema = z.object({
  id: z.string(),
  customerName: z.string(),
  orderAmount: z.number().nonnegative(),
  daysSincePurchase: z.number().int().nonnegative(),
  reason: z.string(),
  evidence: z.string().optional(),
});

const RiskSchema = z.object({
  riskLevel: z.enum(["low", "medium", "high"]),
  category: z.enum(["refund", "replacement", "complaint", "fraud", "other"]),
  summary: z.string().min(1).max(200),
  recommendedAction: z.enum(["auto_refund", "auto_reply", "needs_human_review", "reject"]),
  confidence: z.number().min(0).max(1),
});

const ApprovalSchema = z.object({
  approved: z.boolean(),
  approver: z.string().min(1),
  note: z.string().min(1),
});

type Ticket = z.infer<typeof TicketSchema>;
type Risk = z.infer<typeof RiskSchema>;
type Approval = z.infer<typeof ApprovalSchema>;

type WorkflowState =
  | "received"
  | "analyzed"
  | "auto_processed"
  | "waiting_approval"
  | "approved"
  | "rejected"
  | "done";

type CaseRecord = {
  id: string;
  state: WorkflowState;
  ticket: Ticket;
  risk?: Risk;
  approval?: Approval;
  result?: string;
  updatedAt: string;
};

async function ensureStorage(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }

  if (!existsSync(CASES_FILE)) {
    await writeFile(CASES_FILE, JSON.stringify([], null, 2), "utf-8");
  }
}

async function audit(event: Record<string, unknown>): Promise<void> {
  await appendFile(
    AUDIT_FILE,
    JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n",
    "utf-8"
  );
}

async function loadCases(): Promise<CaseRecord[]> {
  const raw = await readFile(CASES_FILE, "utf-8");
  return JSON.parse(raw) as CaseRecord[];
}

async function saveCases(cases: CaseRecord[]): Promise<void> {
  await writeFile(CASES_FILE, JSON.stringify(cases, null, 2), "utf-8");
}

async function upsertCase(record: CaseRecord): Promise<void> {
  const cases = await loadCases();
  const index = cases.findIndex((item) => item.id === record.id);
  if (index >= 0) {
    cases[index] = record;
  } else {
    cases.push(record);
  }
  await saveCases(cases);
}

async function analyzeTicket(ticket: Ticket): Promise<Risk> {
  const prompt = [
    "你是客服工单分流器。",
    "只输出 JSON，不要解释。",
    "根据退款工单内容判断风险等级和处理建议。",
    "规则：",
    "- 涉及大额金额、频繁退款、疑似欺诈：high",
    "- 普通小额退款且理由清晰：low",
    "- 信息不完整或边界情况：medium",
    "- high 风险必须进入人工审批，不要自动退款",
    "",
    `工单：${JSON.stringify(ticket)}`,
  ].join("\n");

  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: "你是严格的 JSON 风险分类器。" },
      { role: "user", content: prompt },
    ],
  });

  const text = response.choices[0]?.message?.content ?? "";
  return RiskSchema.parse(JSON.parse(text));
}

async function autoProcess(ticket: Ticket, risk: Risk): Promise<string> {
  if (risk.category === "refund" && risk.riskLevel === "low") {
    return `已自动退款 ${ticket.orderAmount.toFixed(2)} 元。`;
  }

  if (risk.category === "complaint") {
    return "已自动发送安抚回复，并升级给客服队列。";
  }

  return "已进入人工队列。";
}

async function requestApproval(record: CaseRecord): Promise<Approval> {
  // 生产中这里可以接入 Slack / 飞书 / Email / Web 审批页
  // 这里为了完整案例，先用命令行模拟人工审批。
  console.log("\n=== 人工审批请求 ===");
  console.log(JSON.stringify(record, null, 2));
  console.log("请在代码里模拟审批结果，或把这里替换成真实审批系统。");

  return ApprovalSchema.parse({
    approved: true,
    approver: "human-operator",
    note: "高风险单据已人工确认可退款",
  });
}

async function processTicket(input: unknown): Promise<CaseRecord> {
  const ticket = TicketSchema.parse(input);
  const id = ticket.id || randomUUID();

  let record: CaseRecord = {
    id,
    state: "received",
    ticket,
    updatedAt: new Date().toISOString(),
  };

  await upsertCase(record);
  await audit({ id, state: "received" });

  const risk = await analyzeTicket(ticket);
  record = {
    ...record,
    state: "analyzed",
    risk,
    updatedAt: new Date().toISOString(),
  };
  await upsertCase(record);
  await audit({ id, state: "analyzed", risk });

  if (risk.riskLevel === "low") {
    const result = await autoProcess(ticket, risk);
    record = {
      ...record,
      state: "auto_processed",
      result,
      updatedAt: new Date().toISOString(),
    };
    await upsertCase(record);
    await audit({ id, state: "auto_processed", result });
  } else {
    record = {
      ...record,
      state: "waiting_approval",
      updatedAt: new Date().toISOString(),
    };
    await upsertCase(record);
    await audit({ id, state: "waiting_approval" });

    const approval = await requestApproval(record);
    record = {
      ...record,
      approval,
      state: approval.approved ? "approved" : "rejected",
      result: approval.approved ? "人工批准通过，执行退款。" : "人工拒绝，不执行退款。",
      updatedAt: new Date().toISOString(),
    };
    await upsertCase(record);
    await audit({ id, state: record.state, approval });
  }

  record = {
    ...record,
    state: "done",
    updatedAt: new Date().toISOString(),
  };
  await upsertCase(record);
  await audit({ id, state: "done" });

  return record;
}

async function main(): Promise<void> {
  await ensureStorage();

  const demoTickets = [
    {
      id: "T-1001",
      customerName: "Alice",
      orderAmount: 59,
      daysSincePurchase: 2,
      reason: "拍错了，想退款",
      evidence: "订单截图已上传",
    },
    {
      id: "T-1002",
      customerName: "Bob",
      orderAmount: 1999,
      daysSincePurchase: 1,
      reason: "账号异常登录后被下单，怀疑欺诈",
      evidence: "登录地点与历史不一致",
    },
  ];

  for (const ticket of demoTickets) {
    const result = await processTicket(ticket);
    console.log("\n=== 处理完成 ===");
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error) => {
  console.error("工作流执行失败:", error);
  process.exit(1);
});
```

## 6. 运行

```bash
npx tsx src/workflow.ts
```

运行后会生成：

- `data/cases.json`：当前工单状态
- `data/audit.log`：审计日志

## 7. 这个案例补上的知识点

- **Workflow > Agent**：不是所有步骤都交给 Agent，确定性流程更可靠。
- **Human-in-the-loop**：高风险任务必须有人工审批点。
- **State Machine**：每个工单都有明确状态，方便恢复和审计。
- **Audit Log**：出问题时可以追踪模型做了什么。
- **Risk-based routing**：低风险自动化，高风险人审。

## 8. 生产建议

| 项目 | 当前示例 | 生产建议 |
|---|---|---|
| 审批 | 命令行模拟 | 接入飞书 / Slack / Jira / Web 审批台 |
| 存储 | JSON 文件 | 接数据库 + 状态机表 + 事件表 |
| 并发 | 单进程串行 | 加队列和锁，避免重复处理 |
| 模型输出 | Zod 校验 JSON | 用 structured output / function calling / schema repair |
| 风险判定 | 模型判断 + 简单规则 | 规则引擎 + 模型 + 黑名单策略组合 |
