# 📚 个人知识库问答系统 (RAG Agent)

基于 RAG（Retrieval-Augmented Generation，检索增强生成）架构的个人知识库问答系统。将本地文档导入后，可以用自然语言提问，系统会从文档中检索相关内容，结合大语言模型生成准确、有来源引用的回答。

## 目录结构

```
ai-study/
├── README.md                    # 本文件
└── agent/                       # 问答 Agent 主目录
    ├── .env                     # 环境变量（API Key 配置）
    ├── package.json             # 依赖和脚本
    ├── tsconfig.json            # TypeScript 配置
    └── src/                     # 源代码
        ├── index.ts             # 主入口 / 命令行交互界面
        ├── loader/              # 文档加载器
        │   └── index.ts         #   加载 txt、md、pdf 文件
        ├── chunker/             # 文档分块器
        │   └── index.ts         #   将长文档切分为可检索的小块
        ├── embedder/            # 向量化（Embedding）
        │   └── index.ts         #   调用阿里云 DashScope 生成文本向量
        ├── store/               # 向量存储
        │   └── index.ts         #   ChromaDB 向量数据库操作
        ├── retriever/           # 检索器
        │   └── index.ts         #   语义搜索，找到最相关的文档块
        ├── qa/                  # 问答引擎
        │   └── index.ts         #   组装提示词，调用 DeepSeek 生成回答
        └── types/               # 类型定义
            └── types.ts         #   全局 TypeScript 类型
```

## 架构与数据流

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  loader  │───▶│ chunker  │───▶│ embedder │───▶│  store   │
│ 加载文档 │    │ 文本分块 │    │ 向量化   │    │ 存入向量库│
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                                                      │
                                              ┌───────▼───────┐
                用户提问 ─────────────────▶│   retriever   │
                                              │  语义检索     │
                                              └───────┬───────┘
                                                      │
                                              ┌───────▼───────┐
                                              │      qa       │
                                              │ RAG 提示词    │
                                              │ DeepSeek 生成 │
                                              └───────────────┘
```

### 处理流程

#### 1. 导入文档（Indexing Pipeline）

| 阶段 | 模块 | 作用 | 关键工具 |
|------|------|------|----------|
| **加载** | `loader` | 读取 `documents/` 目录下的 `.txt`、`.md`、`.pdf` 文件，提取纯文本 | Node.js `fs`、`pdf-parse` |
| **分块** | `chunker` | 将长文档切分为 500 字符、重叠 50 字符的小块，保持语义连贯性 | `@langchain/textsplitters` (RecursiveCharacterTextSplitter) |
| **向量化** | `embedder` | 将每个文本块转换为 1024 维向量（数字数组），用于后续语义搜索 | 阿里云 DashScope `text-embedding-v4` |
| **存储** | `store` | 将向量和原始文本一起存入向量数据库 | ChromaDB |

#### 2. 问答（Query Pipeline）

| 阶段 | 模块 | 作用 |
|------|------|------|
| **检索** | `retriever` | 将用户问题也转为向量，在 ChromaDB 中搜索最相似的文档块（余弦相似度 → 距离转换） |
| **组装** | `qa` | 将检索到的文档块格式化为参考资料，嵌入 RAG 提示词模板 |
| **生成** | `qa` | 调用 DeepSeek 大模型，基于参考资料生成带来源引用的回答 |

## 各模块详解

### [loader](agent/src/loader/index.ts) — 文档加载器
- 扫描 `documents/` 目录，加载所有支持的文件格式
- 支持格式：`.txt`、`.md`、`.pdf`
- PDF 使用 `pdf-parse` 库提取文本
- 每个文件返回一个 `Document` 对象（含内容 + 来源元数据）

### [chunker](agent/src/chunker/index.ts) — 文档分块器
- 使用 `RecursiveCharacterTextSplitter` 进行递归文本切分
- 块大小：500 字符，重叠：50 字符
- 为什么分块：过长的文本会影响检索精度和超出 LLM 上下文限制
- 为什么重叠：避免关键信息被切分边界割裂

### [embedder](agent/src/embedder/index.ts) — 向量化
- 调用阿里云 DashScope 兼容接口的 `text-embedding-v4` 模型
- 输出 1024 维向量
- 支持批量处理（每批最多 10 条），提高效率
- API Key 从 `.env` 的 `ALIYUN_API_KEY` 读取

### [store](agent/src/store/index.ts) — 向量存储
- 基于 ChromaDB 的持久化向量数据库
- 支持：初始化、批量存储、清空、计数、样本查看
- 每条记录包含：唯一 ID、向量、原文、元数据
- 需要先启动 ChromaDB 服务：`chroma run`

### [retriever](agent/src/retriever/index.ts) — 检索器
- 将查询文本向量化后，在 ChromaDB 中执行语义搜索
- 返回相似度分数（0-1，越高越相关）
- 可配置：返回数量 `maxResults`（默认 5）、最低阈值 `scoreThreshold`（默认 0.5）
- 支持 `searchRaw()` 获取原始 ChromaDB 返回值

### [qa](agent/src/qa/index.ts) — 问答引擎
- 接收用户问题，串联检索 → 组装提示词 → 调用 LLM
- RAG 提示词包含严格规则：只基于参考资料回答、标注来源、禁止编造
- 调用 DeepSeek API（`deepseek-v4-flash` 模型）
- 返回答案 + 来源引用列表
- API Key 从 `.env` 的 `DEEPSEEK_API_KEY` 读取

### [types](agent/src/types/types.ts) — 类型定义
- `Document` — 原始文档
- `DocumentChunk` — 分块后的文档片段
- `SearchResult` — 检索结果（含分数）
- `QARequest` / `QAResponse` — 问答的输入输出

## 技术栈

| 类别 | 技术 | 说明 |
|------|------|------|
| 运行时 | Node.js + TypeScript | `tsx` 直接执行 `.ts` 文件 |
| LLM 生成 | DeepSeek (`deepseek-v4-flash`) | 负责理解问题并生成回答 |
| 文本向量化 | 阿里云 DashScope (`text-embedding-v4`) | 1024 维文本嵌入 |
| 向量数据库 | ChromaDB | 存储并检索语义向量 |
| 文档分块 | LangChain TextSplitters | 递归字符分割 |
| PDF 解析 | pdf-parse | 提取 PDF 文本内容 |
| 环境变量 | dotenv | 从 `.env` 加载配置 |

## 快速开始

### 前置条件
- **Node.js** ≥ 22
- **pnpm** ≥ 10（包管理器）
- **ChromaDB** 服务启动（Python 安装）：`pip install chromadb && chroma run`

### 安装与运行

```bash
# 1. 进入 agent 目录
cd agent

# 2. 安装依赖
pnpm install

# 3. 配置 API Key（编辑 .env 文件）
#    DEEPSEEK_API_KEY=你的DeepSeek密钥
#    ALIYUN_API_KEY=你的阿里云百炼密钥

# 4. 启动 ChromaDB（另一个终端窗口）
chroma run

# 5. 运行程序
pnpm start
# 或者
npx tsx src/index.ts
```

### 使用步骤

1. **放入文档** — 将要导入的 `.txt`、`.md`、`.pdf` 文件放到 `agent/documents/` 目录
2. **导入文档** — 在程序中执行 `:import` 命令
3. **提问** — 使用 `:ask <你的问题>` 开始提问

## 命令参考

| 命令 | 说明 | 示例 |
|------|------|------|
| `:ask <问题>` | 向知识库提问 | `:ask 周会讨论了哪些事项？` |
| `:import` | 导入 `documents/` 目录下的所有文档 | `:import` |
| `:upload <路径>` | 上传一个文件到 documents 目录 | `:upload C:\docs\笔记.pdf` |
| `:sources` | 显示上次回答的来源详情 | `:sources` |
| `:count` | 查看知识库中的文档块数量 | `:count` |
| `:help` | 显示帮助信息 | `:help` |
| `:quit` | 退出程序 | `:quit` |

## 配置说明

`.env` 文件配置项：

```bash
# DeepSeek API Key（用于问答生成）
DEEPSEEK_API_KEY=sk-xxx

# 阿里云 DashScope API Key（用于文本向量化）
ALIYUN_API_KEY=sk-xxx
```
