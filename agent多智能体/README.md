# 🤖 多智能体协作系统 (Multi-Agent Orchestrator)

基于多智能体协作架构的任务执行系统。用户只需用自然语言描述目标，系统会自动拆解为子任务，调度不同的专业 Agent（规划、研究、执行、审查）协作完成，并支持会话管理、插件扩展和操作撤销。

## 目录结构

```
agent多智能体/
├── README.md                         # 本文件
├── .env                              # 环境变量（API Key 配置）
├── package.json                      # 依赖和脚本
├── tsconfig.json                     # TypeScript 配置
├── pnpm-workspace.yaml               # pnpm 工作区配置
├── data/                             # 数据目录（会话存档）
│   └── sessions/                     #   会话 JSON 文件
├── workspace/                        # 安全沙箱工作目录
└── src/                              # 源代码
    ├── cli/                          # 命令行入口
    │   └── main.ts                   #   CLI 主程序（Commander 命令注册）
    ├── agent/                        # 智能体
    │   ├── base-agent.ts             #   Agent 基类（统一任务接口 + 事件发布）
    │   ├── planner-agent.ts          #   规划 Agent（目标 → 子任务拆解）
    │   ├── executor-agent.ts         #   执行 Agent（工具调用 + 撤销记录）
    │   ├── researcher-agent.ts       #   研究 Agent（信息整理 + 假设验证）
    │   └── reviewer-agent.ts         #   审查 Agent（质量检查 + 风险评估）
    ├── core/                         # 核心模块
    │   ├── orchestrator.ts           #   主控编排器（调度子 Agent + 汇总结果）
    │   ├── message-bus.ts            #   消息总线（Agent 间事件通信）
    │   ├── session-manager.ts        #   会话管理器（增删改查 + JSON 持久化）
    │   ├── context-manager.ts        #   上下文管理器（滑动窗口 + Pinned 消息）
    │   └── undo-manager.ts           #   撤销管理器（记录+反向操作）
    ├── llm/                          # LLM 接口层
    │   ├── llm-provider.ts           #   LLM Provider 抽象接口
    │   └── openai-provider.ts        #   OpenAI 兼容实现（对接 DeepSeek）
    ├── tools/                        # 工具系统
    │   ├── tool-registry.ts          #   工具注册中心（注册 + 校验 + 调用）
    │   ├── file-tools.ts             #   文件工具（读/写/删 + 沙箱安全 + 撤销支持）
    │   └── shell-tools.ts            #   Shell 工具（白名单 + 子进程安全执行）
    ├── plugins/                      # 插件系统
    │   ├── plugin-types.ts           #   插件 Manifest 结构 + 模块接口定义
    │   └── plugin-loader.ts          #   插件加载器（动态导入 + 生命周期）
    └── type/                         # 类型定义
        └── type.ts                   #   全局 TypeScript 类型
```

## 架构与数据流

```
┌──────────────────────────────────────────────────────────────────┐
│                         用户输入（自然语言目标）                    │
└─────────────────────────────┬────────────────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   Orchestrator    │  主控编排器
                    │  接收目标         │
                    └─────────┬─────────┘
                              │ 派发规划任务
                    ┌─────────▼─────────┐
                    │   PlannerAgent    │  规划 Agent
                    │  目标 → 子任务列表 │
                    └─────────┬─────────┘
                              │ 子任务列表
                    ┌─────────▼─────────┐
                    │   Orchestrator    │  按顺序调度
                    └──┬──────┬──────┬─┘
                       │      │      │
              ┌────────▼┐ ┌───▼───┐ ┌▼────────┐
              │Researcher│ │Executor│ │Reviewer │
              │ 研究分析  │ │ 执行   │ │ 审查    │
              └────┬─────┘ └───┬───┘ └────┬────┘
                   │           │          │
                   │    ┌──────▼──────┐   │
                   │    │ ToolRegistry│   │
                   │    │ 文件/Shell  │   │
                   │    └──────┬──────┘   │
                   │           │          │
                   └───────────┼──────────┘
                               │ 各 Agent 结果
                     ┌─────────▼─────────┐
                     │   Orchestrator    │  汇总 + 返回
                     └───────────────────┘
```

### 处理流程

#### 1. 会话初始化

| 阶段 | 模块 | 作用 |
|------|------|------|
| **创建** | `SessionManager` | 生成唯一会话 ID，初始化工作目录和上下文 |
| **消息** | `SessionManager` | 所有用户输入和 Agent 输出按时间线追加存储 |
| **上下文** | `ContextManager` | 基于滑动窗口（最近 N 条）+ Pinned 消息 + 历史摘要构建 LLM 上下文 |

#### 2. 任务执行（Orchestration Pipeline）

| 阶段 | 模块 | 作用 | 关键机制 |
|------|------|------|----------|
| **规划** | `PlannerAgent` | 将用户目标拆解为 3-5 个可执行子任务 | LLM 生成 JSON，Zod 校验；失败时兜底计划 |
| **研究** | `ResearcherAgent` | 整理已知信息、未知问题、需要验证的假设 | LLM 驱动，不编造来源 |
| **执行** | `ExecutorAgent` | 调用工具完成文件操作、命令执行等动作 | 正则匹配 + LLM 建议；自动记录撤销信息 |
| **审查** | `ReviewerAgent` | 检查产出质量、bug、风险、遗漏和测试缺口 | LLM 审查 |
| **汇总** | `Orchestrator` | 收集所有子任务结果，组装最终回答并写入会话 | 顺序执行（MVP）；失败任务继续处理 |

## 各模块详解

### [Orchestrator](src/core/orchestrator.ts) — 主控编排器
- 接收用户自然语言目标，写入会话历史
- 调用 `PlannerAgent` 将目标拆解为子任务列表
- 按顺序将子任务分发给对应的 Agent（researcher / executor / reviewer）
- 收集各 Agent 的执行结果，汇总为最终回答
- 将所有中间结果和最终回答持久化到会话文件

### [PlannerAgent](src/agent/planner-agent.ts) — 规划 Agent
- 将用户目标拆解为 3-5 个子任务
- 每个子任务包含：标题、描述、分配目标 Agent
- 使用 Zod `PlanSchema` 校验 LLM 输出的 JSON 结构
- LLM 输出不合法时自动降级为兜底三阶段计划（研究 → 执行 → 审查）

### [ExecutorAgent](src/agent/executor-agent.ts) — 执行 Agent
- 接收任务描述，匹配合适的工具执行操作
- MVP 阶段使用正则匹配识别工具调用意图（如"创建文件 xxx 内容 xxx"）
- 未匹配时交给 LLM 生成下一步执行建议
- 自动将有副作用的操作记录到 `UndoManager`，支持撤销

### [ResearcherAgent](src/agent/researcher-agent.ts) — 研究 Agent
- 整理已知信息、分析未知问题、提出需要验证的假设
- 要求不编造来源，约束 LLM 诚实输出
- 可扩展接入 Web Search、企业知识库、MCP 搜索工具

### [ReviewerAgent](src/agent/reviewer-agent.ts) — 审查 Agent
- 检查执行结果的质量、bug、风险、遗漏
- 检查测试缺口
- 输出简洁的审查意见

### [MessageBus](src/core/message-bus.ts) — 消息总线
- 基于 Node.js `EventEmitter` 的事件驱动通信
- 支持点对点（Agent → Agent）和广播（`toAgent: "all"`）两种模式
- 事件类型：`task`（任务派发）、`result`（结果返回）、`log`（过程日志）、`error`（错误）、`tool_call`（工具调用）

### [SessionManager](src/core/session-manager.ts) — 会话管理器
- 基于 JSON 文件的持久化会话存储
- 支持：新建、列表、加载、保存、删除、按更新时间排序
- 每次保存自动更新 `updatedAt` 时间戳
- 消息追加接口自动生成 ID 和时间戳

### [ContextManager](src/core/context-manager.ts) — 上下文管理器
- 滑动窗口机制：只保留最近 N 条普通消息（默认 20 条）
- Pinned 消息：标记为重要的消息不参与裁剪，始终保留
- 历史摘要：长会话自动压缩为摘要，伪装成 system 消息放在最前面
- 摘要触发条件：消息数超过 `maxMessages × 3`

### [UndoManager](src/core/undo-manager.ts) — 撤销管理器
- 记录所有有副作用（带 `undoInfo`）的工具操作
- 支持 `reverse` 类型撤销（反向工具调用恢复）
- 撤销后操作进入 redo 栈，为后续 redo 功能预留
- 新操作发生后自动清空 redo 栈

### [ToolRegistry](src/tools/tool-registry.ts) — 工具注册中心
- 统一注册、查询、调用工具
- 调用前使用 Zod Schema 自动校验参数
- 工具定义包含：名称、描述、参数 schema、副作用标记、处理函数

### [FileTools](src/tools/file-tools.ts) — 文件工具
- `read_file` — 读取 UTF-8 文件（无副作用）
- `write_file` — 写入文件（自动创建父目录；自动计算撤销信息）
- `delete_file` — 删除文件（删除前保存旧内容用于撤销）
- 沙箱安全：所有路径强制限定在 workspace 目录内

### [ShellTools](src/tools/shell-tools.ts) — Shell 工具
- `run_shell` — 在白名单内执行 shell 命令
- 命令白名单：`node`、`npm`、`git`、`npx`
- 子进程在 workspace 目录内执行
- 捕获 stdout 和 stderr 合并返回

### [PluginLoader](src/plugins/plugin-loader.ts) — 插件加载器
- 动态导入插件入口模块
- 执行 `onLoad` / `onUnload` 生命周期方法
- 自动注册插件提供的工具到 `ToolRegistry`
- 支持插件类型：`tool`、`agent`、`middleware`、`provider`

### [Types](src/type/type.ts) — 类型定义
- `AgentName` — Agent 名称联合类型（orchestrator / planner / executor / reviewer / researcher）
- `MessageRole` — 消息角色（user / assistant / system / agent）
- `TaskStatus` — 任务状态（pending / running / success / failed / cancelled）
- `Session` / `SessionMessage` / `SessionContext` — 会话相关结构
- `AgentEvent` — Agent 事件结构
- `SubTask` — 子任务结构（含依赖关系）
- `ToolCall` / `ToolResult` / `UndoInfo` / `ToolDefinition` — 工具系统结构

## 技术栈

| 类别 | 技术 | 说明 |
|------|------|------|
| 运行时 | Node.js + TypeScript | `tsx` 直接执行 `.ts` 文件 |
| LLM 生成 | DeepSeek (`deepseek-v4-flash`) | 通过 OpenAI 兼容接口调用 |
| CLI 框架 | Commander | 命令注册与参数解析 |
| 参数校验 | Zod | LLM 输出校验 + 工具参数校验 |
| 事件通信 | Node.js EventEmitter | Agent 间消息总线 |
| 数据持久化 | JSON 文件 | 会话和消息本地存储 |
| 沙箱安全 | 路径白名单 + 命令白名单 | 文件操作限定 workspace、Shell 限定命令 |
| 包管理器 | pnpm | workspace 模式 |

## 快速开始

### 前置条件
- **Node.js** ≥ 22
- **pnpm** ≥ 10（包管理器）

### 安装与运行

```bash
# 1. 进入 agent多智能体 目录
cd agent多智能体

# 2. 安装依赖
pnpm install

# 3. 配置 API Key（编辑 .env 文件）
#    DEEPSEEK_API_KEY=你的DeepSeek密钥

# 4. 运行开发模式
pnpm dev
```

### 使用步骤

1. **创建会话** — `pnpm dev session:new "我的任务"`
2. **提交任务** — `pnpm dev task "你的自然语言目标"`
3. **查看结果** — 系统自动规划、分派、执行并汇总

## 命令参考

| 命令 | 说明 | 示例 |
|------|------|------|
| `session:new [标题]` | 创建新会话，返回 session_id | `session:new "项目初始化"` |
| `session:list` | 列出所有会话（按更新时间排序） | `session:list` |
| `task <目标>` | 提交自然语言任务 | `task "在 workspace 中创建一个 hello.txt 文件"` |
| `task <目标> -s <id>` | 在指定会话中执行任务 | `task "审查项目" -s abc123` |
| `tools:list` | 列出所有已注册的工具 | `tools:list` |
| `undo` | 撤销最近一次有副作用的操作 | `undo` |

## 插件系统

### 插件 Manifest 结构

每个插件目录需包含 `manifest.json`：

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "type": "tool",
  "description": "一个示例插件",
  "author": "作者名",
  "entry": "index.js",
  "tools": [
    {
      "name": "my_tool",
      "description": "工具描述"
    }
  ],
  "envVars": []
}
```

### 插件入口模块接口

```typescript
export interface PluginModule {
  onLoad?: () => Promise<void> | void;
  onUnload?: () => Promise<void> | void;
  getTools?: () => ToolDefinition[];
}
```

## 配置说明

`.env` 文件配置项：

```bash
# DeepSeek API Key（用于所有 Agent 的 LLM 调用）
DEEPSEEK_API_KEY=sk-xxx
```

## 设计特点

- **多智能体协作**：规划、研究、执行、审查四种专业 Agent 各司其职，由 Orchestrator 统一调度
- **安全沙箱**：文件操作限定在 workspace 目录内，Shell 命令通过白名单控制
- **可撤销**：所有有副作用的操作自动记录撤销信息，支持 `/undo` 回退
- **可扩展**：插件系统支持动态加载工具，LLM Provider 接口支持多种后端
- **会话持久化**：所有对话和执行记录保存为 JSON 文件，支持历史回溯和上下文恢复
- **上下文管理**：滑动窗口 + Pinned 消息 + 历史摘要，平衡 LLM 上下文开销和记忆完整性
