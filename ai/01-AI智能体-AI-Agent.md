# AI Agent（智能体）详解

## 1. 什么是 AI Agent

AI Agent 是一个能够**自主感知环境、制定计划、调用工具、执行动作**的智能系统。与传统的"一问一答"式 LLM 不同，Agent 具备：

- **自主性**：能独立完成任务，不需要人类逐步指导
- **工具使用**：能调用外部 API、数据库、代码执行器等
- **规划能力**：能拆解复杂任务为多步骤执行
- **记忆系统**：短期记忆（上下文）+ 长期记忆（向量库/数据库）
- **反思能力**：能评估自己的输出并自我修正

## 2. Agent 核心架构

### 2.1 经典 ReAct 模式（Reasoning + Acting）

```
用户输入 → 思考(Thought) → 行动(Action) → 观察(Observation) → 思考 → ... → 最终答案
```

**论文**: [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)

**伪代码流程**:
```
1. 用户: "帮我查一下今天北京天气，然后发邮件给老板"
2. Thought: 我需要先查天气，再发邮件
3. Action: call_weather_api("北京")
4. Observation: "北京今天晴，25°C"
5. Thought: 天气信息已获取，现在编写邮件内容并发送
6. Action: send_email(to="boss@company.com", subject="今日天气报告", body="...")
7. Observation: "邮件发送成功"
8. Final Answer: "已完成：查询了北京天气并发送了邮件"
```

### 2.2 规划模块（Planning）

- **任务分解**：将大任务拆解为子任务（如 `Plan-and-Solve` 策略）
- **反思机制**：执行后检查结果，不满足则重新规划
- **树搜索**：Tree-of-Thoughts 探索多条路径

**相关论文**:
- [Chain-of-Thought Prompting](https://arxiv.org/abs/2201.11903)
- [Tree of Thoughts](https://arxiv.org/abs/2305.10601)
- [Plan-and-Solve Prompting](https://arxiv.org/abs/2305.04091)

### 2.3 记忆系统（Memory）

| 类型 | 存储位置 | 生命周期 | 用途 |
|------|----------|----------|------|
| 感官记忆 | 对话上下文 | 单次会话 | 当前对话内容 |
| 短期记忆 | 向量数据库/Redis | 多次会话 | 最近的交互历史 |
| 长期记忆 | 数据库/知识图谱 | 永久 | 用户偏好、知识积累 |

### 2.4 工具使用（Tool Use / Function Calling）

Agent 通过调用外部工具扩展能力：

```typescript
// 工具定义示例 (Zod schema 校验参数)
import { z } from "zod";

const tools = [
  {
    name: "search_web",
    description: "搜索互联网获取实时信息",
    parameters: z.object({
      query: z.string().describe("搜索关键词"),
    }),
  },
  {
    name: "execute_code",
    description: "在沙箱中执行 JavaScript 代码",
    parameters: z.object({
      code: z.string().describe("要执行的代码"),
    }),
  },
  {
    name: "read_file",
    description: "读取本地文件内容",
    parameters: z.object({
      file_path: z.string().describe("文件路径"),
    }),
  },
];
```

## 3. 主流 Agent 框架对比

| 框架 | 语言 | 特点 | 适用场景 |
|------|------|------|----------|
| [LangChain](https://github.com/langchain-ai/langchain) | Python/JS | 生态最大，工具链完善 | 通用 LLM 应用 |
| [LangGraph](https://github.com/langchain-ai/langgraph) | Python | 有状态图 Agent，支持循环/分支 | 复杂多步 Agent |
| [AutoGPT](https://github.com/Significant-Gravitas/AutoGPT) | Python | 自主 Agent 先驱 | 自治任务 |
| [CrewAI](https://github.com/crewAIInc/crewAI) | Python | 多 Agent 角色扮演协作 | 团队协作场景 |
| [AutoGen](https://github.com/microsoft/autogen) | Python | 微软出品，多 Agent 对话 | 企业级多 Agent |
| [MetaGPT](https://github.com/geekan/MetaGPT) | Python | 模拟软件公司多角色 | 自动代码生成 |
| [Dify](https://github.com/langgenius/dify) | Python/TS | 可视化编排 | 低代码 Agent 构建 |
| [Coze](https://www.coze.com/) | 平台 | 字节跳动出品，插件丰富 | 快速搭建 Bot |

## 4. 多 Agent 协作模式

### 4.1 常见协作模式
- **顺序流水线**：Agent A → Agent B → Agent C
- **辩论模式**：多个 Agent 从不同角度论证，汇总后决策
- **角色扮演**：CEO Agent 分配任务，工程师 Agent 写代码，QA Agent 测试
- **层级结构**：管理 Agent 调度子 Agent

### 4.2 关键挑战
- **上下文管理**：多 Agent 对话 token 消耗大
- **任务协调**：如何避免重复工作或冲突
- **错误传播**：一个 Agent 的错误可能影响整个链条
- **成本控制**：多次 LLM 调用成本高

## 5. Agent 开发最佳实践

### 5.1 设计原则
1. **从简单开始**：先用单 Agent + 少量工具，验证可行性后再扩展
2. **工具描述要精确**：工具的名称和描述直接影响 LLM 的选择准确度
3. **做好错误处理**：Agent 调用可能失败，需要重试和降级策略
4. **设置终止条件**：避免 Agent 无限循环消耗 token
5. **记录日志**：每一步的 Thought/Action/Observation 都要记录，便于调试

### 5.2 安全注意事项
- **沙箱执行**：代码执行必须在隔离环境中运行
- **权限控制**：限制 Agent 可调用的工具范围和参数
- **人类审核**：关键操作（如发送邮件、支付）需要人类确认
- **输入验证**：防止 prompt injection 攻击

## 6. 推荐文章与资源

### 必读文章
- [Building effective agents (Anthropic)](https://www.anthropic.com/engineering/building-effective-agents) — **强烈推荐**，Agent 设计圣经
- [LLM Powered Autonomous Agents (Lilian Weng)](https://lilianweng.github.io/posts/2023-06-23-agent/) — Agent 综述
- [Agents (OpenAI Cookbook)](https://cookbook.openai.com/articles/related_resources/agents) — OpenAI 官方 Agent 指南
- [The Rise of AI Agents (a16z)](https://a16z.com/ai-agents/) — 商业视角

### GitHub 仓库
- [awesome-ai-agents](https://github.com/e2b-dev/awesome-ai-agents) — Agent 资源大全
- [AgentGPT](https://github.com/reworkd/AgentGPT) — 浏览器中的自主 Agent
- [SuperAGI](https://github.com/TransformerOptimus/SuperAGI) — 开源 Agent 框架
- [CrewAI Examples](https://github.com/crewAIInc/crewAI-examples) — 多 Agent 示例
