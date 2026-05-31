# MCP (Model Context Protocol) 详解

## 1. 什么是 MCP

MCP（Model Context Protocol）是 Anthropic 推出的一种**开放协议**，用于标准化 AI 模型与外部数据源、工具之间的通信。它解决了 LLM 应用中的一个核心问题：**如何让模型安全、标准化地访问外部上下文和工具**。

可以把 MCP 理解为 **"AI 应用的 USB-C 接口"** — 一个统一的标准，让任何 AI 模型都能即插即用地连接各种数据源和工具。

**官方地址**: https://modelcontextprotocol.io/
**GitHub**: https://github.com/modelcontextprotocol

## 2. 为什么需要 MCP

### 2.1 传统方式的痛点

```
传统方式：每个 AI 应用都要单独对接每个数据源
┌──────────┐    ┌──────────┐    ┌──────────┐
│ AI App 1 │───→│ Google   │    │          │
│          │───→│ Drive    │    │          │
│          │───→│ Slack    │    │          │
├──────────┤    ├──────────┤    ├──────────┤
│ AI App 2 │───→│ Google   │    │  N × M   │
│          │───→│ Drive    │    │  个集成  │
│          │───→│ Slack    │    │          │
└──────────┘    └──────────┘    └──────────┘
```

```
MCP 方式：统一协议，一次集成
┌──────────┐        ┌─────────────┐        ┌──────────┐
│ AI App 1 │──┐     │ MCP Server  │     ┌──│ Google   │
│          │  │     │  (Google)   │─────┘  │ Drive    │
├──────────┤  │     ├─────────────┤        ├──────────┤
│ AI App 2 │  │     │ MCP Server  │        │ Slack    │
│          │  │     │  (Slack)    │        │          │
├──────────┤  ├────→│             │──┐     ├──────────┤
│ Claude   │  │     ├─────────────┤  │     │ Database │
│ Desktop  │──┘     │ MCP Server  │  │     │          │
│          │        │  (Database) │──┘     │          │
└──────────┘        └─────────────┘        └──────────┘
         MCP Client          MCP Server        数据源
```

## 3. MCP 架构详解

### 3.1 核心概念

```
┌──────────────────────────────────────────────────┐
│                   MCP Host                        │
│  ┌────────────────────────────────────────────┐  │
│  │              MCP Client                     │  │
│  │  - 管理多个 MCP Server 连接                 │  │
│  │  - 发现 Server 提供的工具/资源              │  │
│  │  - 路由 AI 请求到对应 Server                │  │
│  └────────────────────────────────────────────┘  │
│                       │                          │
│            ┌──────────┼──────────┐               │
│            ▼          ▼          ▼               │
│     ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│     │MCP Server│ │MCP Server│ │MCP Server│      │
│     │ (文件系统)│ │ (数据库) │ │ (API)    │      │
│     └──────────┘ └──────────┘ └──────────┘      │
└──────────────────────────────────────────────────┘
```

### 3.2 三种核心原语（Primitives）

| 原语 | 说明 | 示例 |
|------|------|------|
| **Resources** | 暴露数据/文件给模型读取 | 文件内容、数据库记录、API 响应 |
| **Tools** | 让模型执行操作 | 创建文件、发送消息、查询数据库 |

### 3.3 传输层（Transport）

MCP 常见传输方式：

| 传输方式 | 说明 | 适用场景 |
|----------|------|----------|
| **stdio** | 标准输入输出，进程间通信 | 本地工具、CLI 工具 |
| **Streamable HTTP** | 基于 HTTP 的远程传输，适合服务端部署 | 远程服务、云端部署 |
| **HTTP + SSE** | 旧版远程传输方式 | 兼容旧客户端 |

> 新项目优先看 stdio 和 Streamable HTTP；HTTP + SSE 更多是兼容历史客户端。

## 4. MCP Server 开发实战 — Zod Schema 写法

> **本文主案例统一使用 `@modelcontextprotocol/server` 2.x alpha 的官方写法。**
> 1.x 稳定版只保留一份对照，方便你看旧项目时能快速对应。

### 4.1 安装

#### alpha 拆包线：`@modelcontextprotocol/server` 2.x

```bash
npm install @modelcontextprotocol/server zod
npm install -D typescript @types/node tsx
```

> `@modelcontextprotocol/server` / `@modelcontextprotocol/client` 是官方 2.0 alpha 拆包线。它们是官方包，但 API 可能继续变化；生产项目要锁定版本并关注升级说明。

### 4.2 工具定义（2.x alpha 官方 registerTool 写法）

官方新示例属于这一类：

```typescript
// server.ts — greeting MCP Server（2.x alpha registerTool 写法）
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const server = new McpServer({
  name: "greeting-server",
  version: "1.0.0",
});

server.registerTool(
  "greet",
  {
    description: "Greet someone by name",
    inputSchema: z.object({
      name: z.string().describe("要问候的人名"),
    }),
  },
  async ({ name }) => ({
    content: [{ type: "text", text: `Hello, ${name}!` }],
  })
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP Server 启动失败:", error);
  process.exit(1);
});
```

这个版本的重点：

- 包名是 `@modelcontextprotocol/server`。
- stdio 传输从 `@modelcontextprotocol/server/stdio` 导入。
- Zod 使用 `zod/v4`。
- 工具注册方法是 `server.registerTool(...)`。
- `inputSchema` 是一个 Zod object，而不是手写 JSON Schema。

### 4.3 资源定义（2.x registerResource 写法）

`McpServer` 提供 `registerResource(...)`，支持静态 URI 和动态模板。

```typescript
// file-server.ts — 文件资源 MCP Server（2.x alpha）
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as fs from "node:fs/promises";

const server = new McpServer({
  name: "file-server",
  version: "1.0.0",
});

server.registerResource(
  "readme",
  "file:///docs/readme.md",
  {
    description: "项目说明文档",
    mimeType: "text/markdown",
  },
  async (uri) => {
    const content = await fs.readFile("/docs/readme.md", "utf-8");
    return {
      contents: [{ uri: uri.href, text: content }],
    };
  }
);

server.registerResource(
  "user-doc",
  new ResourceTemplate("file:///docs/users/{userId}.md", { list: undefined }),
  {
    description: "根据用户 ID 动态读取文档",
    mimeType: "text/markdown",
  },
  async (uri, params) => {
    const { userId } = params;
    const path = `/docs/users/${userId}.md`;
    const content = await fs.readFile(path, "utf-8");
    return {
      contents: [{ uri: uri.href, text: content }],
    };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("File MCP Server 已启动 (stdio)");
}

main().catch((err) => {
  console.error("Server 启动失败:", err);
  process.exit(1);
});
```

### 4.4 完整示例（工具 + 资源，2.x）

```typescript
// full-server.ts — 完整 MCP Server（2.x alpha）
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const server = new McpServer({
  name: "full-demo-server",
  version: "1.0.0",
});

// 工具 1：数学计算
server.registerTool(
  "calculate",
  {
    description: "执行数学计算，支持加减乘除",
    inputSchema: z.object({
      expression: z.string().describe("数学表达式，如 '2 + 3 * 4'"),
    }),
  },
  async ({ expression }) => {
    try {
      const result = eval(expression);
      return {
        content: [{ type: "text", text: `${expression} = ${result}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `计算错误: ${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

// 工具 2：获取当前时间
server.registerTool(
  "get_current_time",
  {
    description: "获取当前系统时间",
    inputSchema: z.object({
      timezone: z.string().default("Asia/Shanghai").describe("时区，如 'Asia/Shanghai'"),
    }),
  },
  async ({ timezone }) => {
    const now = new Date().toLocaleString("zh-CN", { timeZone: timezone });
    return {
      content: [{ type: "text", text: `当前时间 (${timezone}): ${now}` }],
    };
  }
);

// 资源：服务器信息
server.registerResource(
  "server-info",
  "config://server/info",
  {
    description: "当前 MCP Server 的版本和配置信息",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            name: "full-demo-server",
            version: "1.0.0",
            uptime: process.uptime(),
            platform: process.platform,
            nodeVersion: process.version,
          },
          null,
          2
        ),
      },
    ],
  })
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Full Demo MCP Server 已启动 (stdio)");
}

main().catch((err) => {
  console.error("Server 启动失败:", err);
  process.exit(1);
});
```

### 4.5 1.x 稳定版对照（保留一份）

```typescript
// weather-server.ts — 1.x 稳定版对照
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "weather-server",
  version: "1.0.0",
});

server.tool(
  "get_weather",
  "查询指定城市的实时天气信息",
  {
    city: z.string().describe("城市名称，如 '北京'、'Shanghai'"),
  },
  async ({ city }) => {
    const resp = await fetch(`https://api.weather.com/${encodeURIComponent(city)}`);
    const text = await resp.text();
    return {
      content: [{ type: "text" as const, text }],
    };
  }
);
```

**对比底层写法**：无论 `registerTool` 还是 `tool`，都不需要 `setRequestHandler` + `ListToolsRequestSchema` + `CallToolRequestSchema` 三步分开注册，也不需要手写 JSON Schema 和手动做类型断言。

### 4.6 Claude Desktop 配置

```json
// claude_desktop_config.json
{
  "mcpServers": {
    "weather": {
      "command": "npx",
      "args": ["tsx", "server.ts"],
      "env": {
        "API_KEY": "your-api-key"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/path/to/allowed/files"
      ]
    }
  }
}
```

### 4.7 常用 Zod 参数模式速查

| 模式 | 写法 | 说明 |
|------|------|------|
| **必填字符串** | `z.string().describe("描述")` | AI 必须传入该参数 |
| **必填数字** | `z.number().describe("描述")` | 自动校验数字类型 |
| **枚举值** | `z.enum(["option1", "option2"])` | 限定取值范围 |
| **可选参数** | `z.string().optional()` | 参数可传可不传，值为 `string \| undefined` |
| **带默认值** | `z.string().default("default")` | 不传时使用默认值，类型推导为非可选 |
| **嵌套对象** | `z.object({ a: z.string() })` | 复杂参数结构 |
| **数组** | `z.array(z.string())` | 传入字符串数组 |
| **多参数组合** | `{ name: z.string(), age: z.number() }` | 多个参数直接在 schema 对象中列举 |
| **联合类型** | `z.union([z.string(), z.number()])` | 允许多种类型 |
| **添加描述** | `.describe("给 AI 看的描述")` | 帮助 AI 理解参数含义（强烈推荐） |

### 4.8 编译运行

```bash
# 1. 初始化项目
npm init -y
npm install @modelcontextprotocol/server zod
npm install -D typescript @types/node tsx

# 2. 创建 tsconfig.json
```

> 如果你要运行 1.x 对照示例，把安装命令改为 `npm install @modelcontextprotocol/sdk zod`，并使用 `@modelcontextprotocol/sdk/server/mcp.js` / `@modelcontextprotocol/sdk/server/stdio.js` 的导入路径。

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"]
}
```

```bash
# 3. 直接运行（开发模式，推荐使用 tsx）
npx tsx src/server.ts

# 4. 或编译后运行（生产模式）
npx tsc
node dist/server.js
```

## 5. MCP Server 查找与包状态

早期教程经常把 `modelcontextprotocol/servers` 仓库里的包称为“官方 Server 列表”。现在更准确的理解是：

- `modelcontextprotocol/servers`：参考实现和部分常用服务器，不等于完整生态目录。
- MCP Registry：查找可用服务器时优先看 Registry 或对应项目主页。
- npm 包状态会变化：有些旧 `@modelcontextprotocol/server-*` 包仍可安装，有些已经停止维护或迁移。

| Server 类型 | 建议做法 |
|--------|------|
| 文件系统、本地资源 | 可以用 `@modelcontextprotocol/server-filesystem` 这类参考实现，但生产前确认版本、权限边界和维护状态。 |
| GitHub、Slack、数据库等 SaaS | 优先查 MCP Registry / 服务商官方仓库，不要照抄旧教程里的包名。 |
| 自研业务系统 | 建议自己写 MCP Server，只暴露最小工具集合，并用 Zod 严格校验参数。 |

生产接入前检查三件事：

1. `npm view <package> deprecated version` 看包是否已弃用。
2. 看仓库最近提交和 issue，判断是否仍维护。
3. 先用 MCP Inspector 本地调通，再接入 Claude Desktop、Cursor、Codex 等 Host。

## 6. MCP 生态工具

### 6.1 开发工具
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector) — MCP Server 调试工具
- [FastMCP](https://github.com/jlowin/fastmcp) — 更简洁的 MCP Server 开发框架
- [MCP CLI](https://github.com/modelcontextprotocol/servers) — 命令行管理工具

### 6.2 应用集成
- **Claude Desktop** — 原生支持 MCP
- **Continue.dev** — VS Code AI 插件支持 MCP
- **Zed Editor** — 原生 MCP 支持
- **Sourcegraph Cody** — 代码 AI 助手

## 7. 推荐文章与资源

### 必读文章
- [MCP 官方文档](https://modelcontextprotocol.io/docs) — 从入门到精通
- [Introducing MCP (Anthropic 官方博客)](https://www.anthropic.com/news/model-context-protocol)
- [MCP 协议规范 (GitHub)](https://github.com/modelcontextprotocol/specification) — 完整协议定义
- [Building MCP Servers 指南](https://modelcontextprotocol.io/docs/concepts/architecture)

### GitHub 仓库
- [MCP Servers 参考实现](https://github.com/modelcontextprotocol/servers) — 常用 Server 和参考实现
- [MCP Registry](https://modelcontextprotocol.io/registry) — 查找 MCP Server 的入口
- [Awesome MCP](https://github.com/punkpeye/awesome-mcp-servers) — 社区 MCP Server 合集
- [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [FastMCP](https://github.com/jlowin/fastmcp) — Pythonic 的 MCP 开发体验

### 视频教程
- [MCP Explained (YouTube)](https://www.youtube.com/results?search_query=model+context+protocol+explained)
- [MCP 入门到精通 (B站)](https://search.bilibili.com/all?keyword=MCP%20Model%20Context%20Protocol)
