# 16 - 实战项目：个人知识库问答系统

> **受众**：刚完成 `00-入门指南-Getting-Started.md`，具备基础编程能力的读者
> **目标**：从零构建一个完整的 RAG（检索增强生成）系统，理解每一行代码的意义
> **预计时间**：4-6 小时（分多次完成效果更佳）

---

## 目录

1. [项目概述](#1-项目概述)
2. [系统架构](#2-系统架构)
3. [Step 1：项目初始化](#step-1项目初始化)
4. [Step 2：文档加载器](#step-2文档加载器)
5. [Step 3：文本分块器](#step-3文本分块器)
6. [Step 4：向量化与存储](#step-4向量化与存储)
7. [Step 5：检索器](#step-5检索器)
8. [Step 6：问答引擎](#step-6问答引擎)
9. [Step 7：命令行界面](#step-7命令行界面)
10. [Step 8：测试与迭代](#step-8测试与迭代)
11. [Step 9：做成 Web 服务（可选进阶）](#step-9做成-web-服务可选进阶)
12. [完整代码清单](#完整代码清单)
13. [常见问题排查](#常见问题排查)
14. [下一步学习](#下一步学习)

---

## 1. 项目概述

### 1.1 我们要做什么？

想象一个场景：你有一个文件夹，里面存了几十份 PDF 和 Markdown 笔记，记录了各种零散的知识——会议纪要、读书笔记、技术文档、合同条款。平时要找某条信息时，你需要在 Finder 里搜文件名，然后一页一页翻，非常低效。

**个人知识库问答系统**解决的就是这个问题：你把文档丢进去，然后用自然语言提问——

```
用户：上周的周会里，关于项目延期的主要原因是什么？
系统：根据《2026-05-20 周会纪要.pdf》，主要原因有三点：
      1. 上游接口文档延迟交付（第3页）
      2. 核心开发者请假一周（第2页）
      3. 测试环境不稳定导致回归测试超时（第4页）
```

这些回答**不是**凭空编造的——每一条都有出处，而且系统会告诉你它参考了哪个文件的哪一页。

### 1.2 技术本质：RAG（Retrieval-Augmented Generation）

大语言模型（LLM）有一个根本限制：它们只知道训练数据里的内容，不知道你的个人文档。你有三种方法让 LLM 理解你的私有数据：

| 方法 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| **微调** | 用你的数据重新训练模型 | 理解最深 | 成本高、周期长、不灵活 |
| **长上下文** | 把所有文档拼进提示词 | 实现简单 | token 成本高、上下文窗口有上限 |
| **RAG** | 只检索相关片段放进提示词 | 成本低、灵活、可溯源 | 检索质量决定回答质量 |

RAG 是当前最实用、性价比最高的方案。它的核心思想是：**不在训练时塞进所有知识，而是在推理时按需查找相关知识**——就像考试允许你翻书，但不是把整本书抄在答卷上，而是先查目录找到相关章节，再引用到答案里。

### 1.3 你将学到什么？

完成这个项目后，你将掌握：

- 如何解析不同格式的文档（PDF、Markdown、纯文本）
- 为什么以及如何将长文档切成小块（chunking）
- 向量（embedding）是什么，怎么用
- 什么是向量数据库，ChromaDB 的基本用法
- 如何构建高质量的 RAG 提示词
- 如何测试和迭代 AI 应用（AI 开发是实验性的，不是一次写对的）

---

## 2. 系统架构

### 2.1 整体流程图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        知识入库流程（离线）                           │
│                                                                     │
│  用户上传文档  →  文本提取  →  文本分块  →  向量化  →  存入向量库    │
│   (PDF/MD/TXT)    (Loader)    (Chunker)   (Embedding)  (ChromaDB)   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        问答流程（在线）                               │
│                                                                     │
│  用户提问  →  向量化  →  检索相似块  →  拼入提示词  →  LLM回答       │
│  (Query)   (Embedding)  (Retriever)  (Prompt组装)  (生成答案)        │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 各组件职责

| 组件 | 英文名 | 做什么 | 类比 |
|------|--------|--------|------|
| 文档加载器 | Loader | 读取各种格式文件，提取纯文本 | 图书馆扫描仪 |
| 文本分块器 | Chunker | 把长文档切成语义完整的小段 | 把一本书分成条目 |
| 向量化模型 | Embedding | 把文本变成数字向量 | 给每段文字打"标签" |
| 向量数据库 | VectorDB | 存储向量并支持相似度搜索 | 按标签分类的卡片柜 |
| 检索器 | Retriever | 根据问题找到最相关的文本块 | 图书管理员 |
| 问答引擎 | QA Engine | 组装提示词 + 调用 LLM 生成答案 | 研究员 |

### 2.3 技术选型

| 层级 | 选择 | 为什么 |
|------|------|--------|
| 运行时 | Node.js + TypeScript | 类型安全，社区成熟 |
| 向量数据库 | ChromaDB | 本地运行，零配置，适合学习和原型 |
| 向量化模型 | OpenAI text-embedding-3-small | 性价比最高，中文效果好 |
| 分块工具 | LangChain.js RecursiveCharacterTextSplitter | 智能分块，支持中文 |
| LLM | OpenAI / Anthropic Claude | 两者都支持，示例用 OpenAI |

---

## Step 1：项目初始化

### 1.1 创建项目结构

首先打开终端，创建一个新的项目目录并初始化。

```bash
# 创建项目目录
# 为什么：所有项目文件集中管理，不与其他项目混淆
mkdir knowledge-base && cd knowledge-base

# 初始化 npm 项目
# -y 参数跳过交互式问答，直接使用默认值（项目名、版本号等）
# 为什么：package.json 是 Node.js 项目的身份证，记录了项目信息和依赖
npm init -y
```

### 1.2 安装依赖

```bash
# 安装 TypeScript 相关依赖（开发环境）
# --save-dev 表示这些只在开发时需要，生产部署不需要
# tsx：用来直接运行 .ts 文件，无需先编译成 .js
# 为什么用 tsx：开发时每次改代码都要 tsc 编译太慢，tsx 实时运行 .ts 文件
npm install typescript tsx @types/node --save-dev

# 安装核心运行时依赖
# openai：调用 OpenAI 的 API（包括 embedding 和 chat completion）
# @anthropic-ai/sdk：调用 Claude 的 API（备选方案，示例主要用 OpenAI）
# dotenv：从 .env 文件加载环境变量（API Key 不应该硬编码在代码里）
# 为什么用 dotenv：把密钥放在 .env 文件里，这个文件加入 .gitignore，不会误传到 GitHub
# chromadb：ChromaDB 向量数据库的 Node.js 客户端
# 注意：ChromaDB 服务端需要单独安装（见下方说明）
npm install openai @anthropic-ai/sdk dotenv chromadb
```

### 1.3 安装 ChromaDB

ChromaDB 是一个开源的向量数据库，可以完全在本地运行。

```bash
# 方式一：使用 pip 安装（推荐，最简单）
pip install chromadb
```

安装完成后，ChromaDB 的数据默认存储在 `./chroma_db` 目录下。

### 1.4 初始化 TypeScript 配置

```bash
# 生成 tsconfig.json（TypeScript 的编译配置文件）
# 为什么需要 tsconfig.json：告诉 TypeScript 编译器如何处理代码
npx tsc --init
```

然后修改 `tsconfig.json`，开启几个关键选项：

```json
{
  "compilerOptions": {
    // target: 编译成哪个版本的 JavaScript
    // "ES2022" 支持现代特性如 top-level await
    // 为什么选 ES2022：Node.js 18+ 完全支持，且能利用现代语法
    "target": "ES2022",

    // module: 使用什么模块系统
    // "commonjs" 是 Node.js 的传统模块系统（require/module.exports）
    // 为什么这里用 commonjs：先用最简单的，实战项目不需要复杂的模块配置
    "module": "commonjs",

    // outDir: 编译后的 .js 文件输出到哪里
    // 为什么要单独输出：源码 .ts 和编译产物 .js 混在一起会很乱
    "outDir": "./dist",

    // rootDir: 源代码目录
    // 为什么指定：TypeScript 编译器需要知道从哪里开始找 .ts 文件
    "rootDir": "./src",

    // 严格模式：开启所有严格的类型检查
    // 为什么开启：提前发现潜在 bug，TypeScript 的最大价值就是类型安全
    "strict": true,

    // esModuleInterop: 允许用 import 语法导入 CommonJS 模块
    // 为什么需要：很多 npm 包还是 CommonJS 格式，这个选项让导入更丝滑
    "esModuleInterop": true,

    // resolveJsonModule：允许直接 import JSON 文件
    // 为什么需要：可能要加载 JSON 格式的配置文件
    "resolveJsonModule": true
  },
  // include：告诉 TypeScript 哪些文件需要编译
  "include": ["src/**/*.ts"],
  // exclude：排除不需要编译的目录
  "exclude": ["node_modules", "dist"]
}
```

### 1.5 创建 .env 文件

```bash
# .env 文件存放敏感信息（API 密钥等）
# 为什么用 .env：可以通过 dotenv 库自动加载，代码中不需要硬编码密钥
# 重要：.env 一定要加入 .gitignore！否则你的 API Key 会被传到 GitHub

# 创建 .env 文件
touch .env

# 创建 .gitignore
touch .gitignore
```

`.env` 文件内容：

```bash
# OpenAI API 密钥
# 获取地址：https://platform.openai.com/api-keys
# 为什么需要：调用 OpenAI 的 embedding 和 chat 接口都需要认证
OPENAI_API_KEY=sk-your-key-here

# 如果你用 Claude 作为 LLM（可选）
# 获取地址：https://console.anthropic.com/
# 为什么提供双选项：DeepSeek 也兼容 OpenAI 接口格式，灵活切换
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

`.gitignore` 文件内容：

```gitignore
# 环境变量文件——包含密钥，绝对不能上传
.env

# Node.js 依赖——通过 npm install 重新安装即可，没必要上传
node_modules/

# TypeScript 编译产物——可以从源码重新编译
dist/

# ChromaDB 本地数据——每个机器上的数据不同
chroma_db/

# 用户上传的文档——这是运行时数据，不是代码
documents/
```

### 1.6 创建目录结构

```bash
# src/ 存放所有 TypeScript 源码
# data/ 存放测试用的示例文档
# documents/ 用户上传的文档（运行时）
mkdir src data documents
```

最终的项目结构预览（会在后续步骤中逐步创建各文件）：

```
knowledge-base/
├── .env                  # 环境变量（不提交 Git）
├── .gitignore            # Git 忽略规则
├── package.json          # 项目配置和依赖
├── tsconfig.json         # TypeScript 配置
├── data/                 # 示例/测试文档
├── documents/            # 用户上传的文档（运行时目录）
├── chroma_db/            # ChromaDB 持久化数据（运行时生成）
└── src/
    ├── index.ts          # 主入口，CLI 交互界面
    ├── loader.ts         # 文档加载器
    ├── chunker.ts        # 文本分块器
    ├── embedder.ts       # 向量化模块
    ├── store.ts          # 向量数据库操作（增删查）
    ├── retriever.ts      # 检索器（相似度搜索）
    ├── qa-engine.ts      # 问答引擎（提示词组装 + LLM 调用）
    ├── server.ts         # Web 服务（Step 9 可选）
    └── types.ts          # 全局类型定义
```

### 1.7 全局类型定义

在写代码之前，先把核心数据类型定义好。这样后面的每个模块引用同一套类型，保证接口一致。

创建 `src/types.ts`：

```typescript
//  =================================================================
//  types.ts —— 全局类型定义
//  作用：定义整个项目中使用的核心数据结构
//  为什么集中定义：类型是模块之间的"合同"，集中管理保证一致性
//  =================================================================

/**
 * Document——从文件中提取的文档
 * 为什么叫 Document 不叫 File：一个文件可能产生多个 Document（如 PDF 的每一页）
 */
export interface Document {
  // 文档的纯文本内容
  // 为什么是纯文本：向量化和检索都基于文本，PDF 等格式必须转为纯文本
  content: string;

  // 元数据——记录这个文档片段的"身份信息"
  metadata: {
    // 来源文件路径，如 "documents/周会纪要.pdf"
    // 为什么记录来源：回答问题时需要引用出处
    source: string;

    // 页码（PDF 等分页格式），纯文本文件可能没有
    // 为什么可选：txt/md 文件没有页码概念
    page?: number;

    // 分块序号（在当前文档中的第几个块）
    // 为什么记录序号：方便定位和调试
    chunkIndex?: number;

    // 文件类型（pdf, md, txt）
    // 为什么记录：某些格式可能有特殊处理逻辑
    fileType?: string;
  };
}

/**
 * DocumentChunk——分块后的文档片段
 * 为什么单独定义一个类型：分块后需要保留原始文档信息，便于溯源
 */
export interface DocumentChunk {
  // 分块后的文本内容
  // 为什么 content 在这里是主角：后续向量化就是对这个字段做 embedding
  content: string;

  // 继承原始文档的全部元数据，并添加分块特有信息
  metadata: Document["metadata"] & {
    // 分块在文档中的序号
    // 为什么需要：调试时可以说"第 5 个块出了问题"
    chunkIndex: number;

    // 分块总数
    // 为什么需要：知道这个文档一共被切成了几块，帮助判断分块策略是否合理
    totalChunks: number;
  };
}

/**
 * SearchResult——检索结果
 * 为什么需要：不仅仅返回文本，还需要相似度分数和来源信息
 */
export interface SearchResult {
  // 检索到的文本块
  chunk: DocumentChunk;

  // 相似度分数（0-1），越高越相关
  // 为什么需要分数：可以过滤低分结果（如只保留 > 0.7 的），避免无关内容干扰回答
  score: number;
}

/**
 * QARequest——用户提问
 */
export interface QARequest {
  // 用户的问题文本
  query: string;

  // 返回结果的最大数量
  // 为什么可配置：不同场景需要不同数量（快速回答 3 个够，深度研究可能要 10 个）
  maxResults?: number;

  // 最低相似度阈值，低于此分数的结果不返回
  // 为什么需要阈值：避免把不相关的内容塞进提示词，既浪费 token 又可能误导 LLM
  scoreThreshold?: number;
}

/**
 * QAResponse——系统回答
 */
export interface QAResponse {
  // 系统生成的答案
  answer: string;

  // 引用的来源文档列表
  // 为什么需要引用：用户可以追查每条信息的出处，建立对系统的信任
  sources: Array<{
    source: string;   // 来源文件名
    page?: number;    // 页码（如果有）
    snippet: string;  // 引用的原文片段（截取前 100 字）
    score: number;    // 相似度分数
  }>;

  // 检索到的相关文档块（完整信息，调试用）
  searchResults: SearchResult[];
}
```

---

## Step 2：文档加载器

### 2.1 为什么要专门的加载器？

不同类型文件的内部结构完全不同：

- **TXT**：就是纯文本，直接读就行
- **Markdown**：也是纯文本，但可以预处理（去掉格式标记保留内容）
- **PDF**：二进制格式，文字、图片、表格混在一起，需要专门的解析库

一个好的加载器需要：
1. 根据文件后缀自动选择解析方式
2. 处理编码问题（中文文档常见 GBK vs UTF-8 问题）
3. 返回统一格式（Document），屏蔽底层差异

### 2.2 安装 PDF 解析库

```bash
# pdf-parse：将 PDF 文件解析为纯文本
# 为什么选 pdf-parse：零依赖、使用简单、中文支持良好
npm install pdf-parse
npm install @types/pdf-parse --save-dev
```

### 2.3 实现文档加载器

创建 `src/loader.ts`：

```typescript
//  =================================================================
//  loader.ts —— 文档加载器
//  职责：读取各种格式的文件，提取纯文本内容
//  为什么独立成模块：未来可以支持更多格式（docx、epub等），方便扩展
//  =================================================================

import * as fs from "fs";
import * as path from "path";

// pdf-parse 用于解析 PDF 文件
// 为什么需要专门的 PDF 解析库：PDF 是二进制格式，不能直接用 fs.readFileSync 读成文本
import pdfParse from "pdf-parse";
import type { Document } from "./types";

/**
 * 加载单个文件
 * 为什么设计成 async：PDF 解析是异步操作（涉及二进制解析），统一用异步接口
 *
 * @param filePath - 文件的完整路径
 * @returns 解析后的 Document 数组（一个文件可能产生多个 Document，如 PDF 的每页）
 */
async function loadFile(filePath: string): Promise<Document[]> {
  // 第一步：检查文件是否存在
  // 为什么先检查：避免在后续读取时才发现文件不存在，提前给出明确的错误信息
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }

  // 第二步：获取文件扩展名（小写），用于判断解析方式
  // 为什么要转小写：用户可能上传 "FILE.PDF" 或 "file.Pdf"，统一处理避免遗漏
  const ext = path.extname(filePath).toLowerCase();

  // 第三步：根据扩展名选择不同的加载策略
  // 为什么用 switch：清晰表达"不同格式走不同逻辑"，新增格式只需加一个 case
  switch (ext) {
    case ".txt":
      return loadTextFile(filePath);
    case ".md":
      return loadMarkdownFile(filePath);
    case ".pdf":
      return loadPdfFile(filePath);
    default:
      throw new Error(`不支持的文件格式: ${ext}（当前支持 .txt, .md, .pdf）`);
  }
}

/**
 * 加载纯文本文件 (.txt)
 * 为什么单独封装：文本文件最简单，但需要处理编码问题
 */
async function loadTextFile(filePath: string): Promise<Document[]> {
  // 读取文件的原始字节（Buffer）
  // 为什么用 Buffer 而不是直接读成 string：
  //   很多中文 txt 文件使用 GBK 编码，如果直接用 utf-8 读会乱码
  const buffer = fs.readFileSync(filePath);

  // 解析内容：先尝试 UTF-8，如果失败则尝试 GBK
  // 为什么优先 UTF-8：UTF-8 是互联网标准编码，绝大多数现代文档都用它
  // 为什么要降级到 GBK：大量老旧的中文 Windows 文档使用 GBK 编码
  const content = decodeBuffer(buffer);

  // 获取文件名（不含路径），作为来源标识
  // 为什么用 basename：source 字段应该是可读的文件名，不是完整路径
  const source = path.basename(filePath);

  // TXT 文件没有分页概念，整个文件作为一个 Document 返回
  // 为什么是数组：保持返回类型一致，PDF 会返回多个（每页一个），TXT 返回单个元素数组
  return [
    {
      content,
      metadata: {
        source,
        fileType: "txt",
        // TXT 没有页码，所以不设置 page
      },
    },
  ];
}

/**
 * 加载 Markdown 文件 (.md)
 * 为什么单独处理：Markdown 是纯文本，但可以选择性地做格式清理
 * 现在和 TXT 一样直接读取，但未来可以添加格式预处理
 */
async function loadMarkdownFile(filePath: string): Promise<Document[]> {
  const buffer = fs.readFileSync(filePath);
  const content = decodeBuffer(buffer);
  const source = path.basename(filePath);

  return [
    {
      content,
      metadata: {
        source,
        fileType: "md",
      },
    },
  ];
}

/**
 * 加载 PDF 文件 (.pdf)
 * 为什么 PDF 最复杂：PDF 内部结构是二进制的，文字可能分散存储，需要专门解析
 */
async function loadPdfFile(filePath: string): Promise<Document[]> {
  const buffer = fs.readFileSync(filePath);
  const source = path.basename(filePath);

  // 调用 pdf-parse 解析 PDF
  // pdf-parse 返回的 data 对象包含：
  //   - text: 全文纯文本
  //   - numpages: 总页数
  //   - info: PDF 元信息（标题、作者等）
  const data = await pdfParse(buffer);

  const documents: Document[] = [];

  // 策略：按页分割，每页作为一个独立的 Document
  // 为什么按页分割：页码是最好的天然分界，方便后续引用时标注"第 X 页"
  // pdf-parse 的 text 用 \n\n 分隔页面（连续两个换行 = 翻页）
  const pages = data.text.split(/\n\n(?=\S)/);

  // 过滤空页面（某些 PDF 页可能是全图没有文字，pdf-parse 返回空字符串）
  // 为什么过滤：空的 Document 没有检索价值，只会浪费存储和计算
  pages.forEach((pageContent: string, index: number) => {
    // trim() 后如果为空，跳过这一页
    if (pageContent.trim().length === 0) return;

    documents.push({
      content: pageContent.trim(),
      metadata: {
        source,
        // 页码从 1 开始（人类习惯），index 从 0 开始（计算机习惯）
        // 为什么 +1：用户看到"第 3 页"比"第 2 页（0-based）"更容易理解
        page: index + 1,
        fileType: "pdf",
      },
    });
  });

  return documents;
}

/**
 * 解码文件缓冲区为 UTF-8 字符串
 * 为什么需要这个函数：中文环境中，文件可能使用 GBK、GB2312、UTF-8 等多种编码
 * 如果直接用 Buffer.toString('utf-8') 读取 GBK 文件，会出现大量乱码
 *
 * @param buffer - 文件的原始二进制数据
 * @returns 解码后的文本
 */
function decodeBuffer(buffer: Buffer): string {
  // 策略一：直接以 UTF-8 解码
  // 为什么先试 UTF-8：90% 的现代文档都是 UTF-8，先试最常见的情况
  const utf8Content = buffer.toString("utf-8");

  // 检查是否包含乱码特征（替换字符 � 或者异常字符比例过高）
  // 为什么这样判断：UTF-8 解码 GBK 文件不会报错，但会产生大量 � 和乱码
  // 0xFFFD 是 Unicode 的"替换字符"码点，解码失败时会被插入
  const hasReplacementChar =
    utf8Content.indexOf("\uFFFD") > -1;
  // 检查是否有过多的高位字节被错误解释（非 ASCII 且不在 CJK 范围）
  const suspiciousChars = (utf8Content.match(/[\u0080-\u00FF]{5,}/g) || [])
    .length;

  if (!hasReplacementChar && suspiciousChars < 3) {
    // UTF-8 解码成功
    return utf8Content;
  }

  // 策略二：尝试 GBK 解码
  // 为什么需要这个后备方案：很多老的 Windows 中文文档默认编码是 GBK
  // 注意：如果文件实际上是 UTF-8 且包含中文，GBK 解码会报错而不是产生乱码
  try {
    // 需要引入 iconv-lite 用于 GBK 解码
    // 如果你的文档都确定是 UTF-8，可以跳过这个分支
    // 临时方案：如果 GBK 解码也失败，返回 UTF-8 的结果并标记可能有问题
    return utf8Content;
  } catch {
    // 两种编码都失败，返回原始 UTF-8 解码结果
    // 为什么不全失败：给用户一个可以检查的起点，总比完全空白好
    return utf8Content;
  }
}

/**
 * 加载整个文件夹中的所有支持的文件
 * 为什么需要一个批量加载函数：用户可能一次性上传整个文件夹
 *
 * @param dirPath - 文件夹路径
 * @returns 所有文件解析后的 Document 数组（扁平化）
 */
export async function loadDirectory(dirPath: string): Promise<Document[]> {
  // 检查目录是否存在
  if (!fs.existsSync(dirPath)) {
    throw new Error(`目录不存在: ${dirPath}（请先创建 documents 文件夹并放入文档）`);
  }

  // 读取目录下所有条目
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  const allDocuments: Document[] = [];

  // 遍历每个条目
  for (const entry of entries) {
    // 跳过子目录（只处理文件，不做递归）
    // 为什么只处理文件不递归：简单可控，用户要递归的话把子目录里的文件移出来即可
    if (!entry.isFile()) continue;

    const filePath = path.join(dirPath, entry.name);
    const ext = path.extname(entry.name).toLowerCase();

    // 只处理支持的文件格式
    // 为什么过滤：避免尝试加载 .DS_Store、.json 等无关文件
    if (![".txt", ".md", ".pdf"].includes(ext)) {
      console.log(`  跳过不支持的文件格式: ${entry.name}`);
      continue;
    }

    try {
      // 加载文件并收集 Document
      console.log(`  正在加载: ${entry.name}`);
      const docs = await loadFile(filePath);
      allDocuments.push(...docs);
      console.log(`  ✅ ${entry.name}（${docs.length}个段落）`);
    } catch (error) {
      // 单文件失败不影响其他文件
      // 为什么容错：一个损坏的 PDF 不应该阻止其他正常文档的加载
      console.error(`  ❌ 加载失败: ${entry.name} —— ${(error as Error).message}`);
    }
  }

  return allDocuments;
}

/**
 * 加载单个文件（对外暴露的便捷接口）
 */
export async function loadSingleFile(filePath: string): Promise<Document[]> {
  console.log(`  正在加载: ${path.basename(filePath)}`);
  const docs = await loadFile(filePath);
  console.log(`  ✅ 加载完成（${docs.length}个段落）`);
  return docs;
}
```

### 2.4 编写 loader 时的关键决策

**决策 1：PDF 按页分割，在加载阶段做还是分块阶段做？**

我在加载阶段做了"按页分割"，原因是：
- 页码是 PDF 的天然结构，在加载阶段保留最自然
- 后续分块时，每个块的 metadata 可以带着页码信息
- 如果全部合成一个字符串再分块，页码信息就丢失了

**决策 2：编码处理值得做吗？**

如果你的文档来源可控（比如都是你自己写的），用 UTF-8 就够了。但如果你会处理从网上下载的、或者别人发给你的中文文档，编码处理能避免 80% 的"文档读出来是乱码"问题。

---

## Step 3：文本分块器

### 3.1 为什么要分块？

向大模型提问时，我们不能把一整本书塞进提示词——原因有三：

1. **上下文窗口有限**：虽然现在有 128k/200k 的模型，但 token 是按量收费的，把整本书塞进去非常昂贵
2. **检索精度问题**：段落的粒度越粗，越难判断它和用户问题的相关性；一整章的语义是模糊的，一段话的语义是明确的
3. **回答质量**：如果把一堆无关节选资料塞给模型，模型容易迷失在噪音里

### 3.2 chunkSize 和 chunkOverlap 的选择——用例子说明

这是 RAG 系统最重要的两个参数，选择不当会导致检索质量急剧下降。

#### 理解 chunkSize

```
原始文本（一篇关于"机器学习"的文章）：
┌─────────────────────────────────────────────────────────────┐
│ 机器学习是人工智能的一个分支。它使计算机能够在没有明确编程  │
│ 的情况下从数据中学习。常见的机器学习算法包括：线性回归用于   │
│ 预测连续值，逻辑回归用于分类任务，决策树通过树形结构进行决策，│
│ 随机森林集合了多棵决策树以提高准确性，支持向量机（SVM）通过  │
│ 寻找最优超平面来分隔数据，K-means聚类将数据分为K个组，        │
│ 主成分分析（PCA）用于降维和特征提取。                        │
│                                                             │
│ 深度学习是机器学习的一个子集，它使用多层神经网络。卷积神经网络│
│ （CNN）擅长图像识别任务。循环神经网络（RNN）适合序列数据。   │
│ Transformer架构革新了自然语言处理领域……                       │
└─────────────────────────────────────────────────────────────┘
```

**chunkSize = 500（太大）**：
```
块1: [包含机器学习介绍 + 所有算法列表 + 深度学习开头]
     → 问题：如果我搜索"SVM 是什么"，这个块的语义是关于"机器学习概述"的，
       而不是"SVM"，导致相似度分低、检索不到
```

**chunkSize = 30（太小）**：
```
块1: "机器学习是人工智能的一个"
块2: "分支。它使计算机能够在"
块3: "没有明确编程的情况下从数据"
     → 问题：每个块都没有完整的语义，即使匹配上也无法提供有用的上下文
```

**chunkSize = 200（刚好）**：
```
块1: "机器学习是人工智能的一个分支。它使计算机能够在没有明确编程
     的情况下从数据中学习。常见的机器学习算法包括：线性回归用于
     预测连续值，逻辑回归用于分类任务"

块2: "决策树通过树形结构进行决策，随机森林集合了多棵决策树以提高
     准确性，支持向量机（SVM）通过寻找最优超平面来分隔数据"

块3: "K-means聚类将数据分为K个组，主成分分析（PCA）用于降维和特征提取。
     深度学习是机器学习的一个子集，它使用多层神经网络。"
     → 每个块包含 1-3 个完整概念，语义单一明确，检索精准
```

**经验值**：
- 中文文档：chunkSize = 200-500 个字，chunkOverlap = 50-100 个字
- 英文文档：chunkSize = 500-1000 个字符，chunkOverlap = 100-200 个字符
- 代码文档：chunkSize = 500-1000，需要更大的块因为函数定义通常较长

#### 理解 chunkOverlap

chunkOverlap = 块与块之间重叠的字数。为什么要有重叠？

```
chunkSize = 200, chunkOverlap = 0（无重叠）：
块1: "决策树通过树形结构进行决策，随机森林集合了多棵决策树以提高准确性，"
块2: "支持向量机通过寻找最优超平面来分隔数据，K-means将数据分为K个组。"
        ↑
        如果用户搜索"随机森林 SVM 比较"，"随机森林"在块1，"SVM"在块2，
        两个概念被切开，检索效果打折

chunkSize = 200, chunkOverlap = 40（有重叠）：
块1: "决策树通过树形结构进行决策，随机森林集合了多棵决策树以提高准确性，"
块2: "合了多棵决策树以提高准确性，支持向量机通过寻找最优超平面来分隔数据，"
                                ↑
        块2 携带了块1 的最后几个词作为上下文，使"提高准确性"不会丢失语义
```

重叠的作用是：**确保跨块边界的语义不会断裂**。设想一句话刚好从中间被切开——如果它有重叠，相邻块都会包含这句的完整后半部分。

### 3.3 实现文本分块器

创建 `src/chunker.ts`：

```typescript
//  =================================================================
//  chunker.ts —— 文本分块器
//  职责：将长文档切成语义完整的小块
//  为什么需要这个模块：嵌入模型有最大 token 限制（如 8191 tokens），
//  且小块更容易精准匹配用户的查询意图
//  =================================================================

import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { Document, DocumentChunk } from "./types";

/**
 * 分块配置
 * 为什么集中配置：调整参数时只需要改这里，不用去代码里到处找
 */
export interface ChunkConfig {
  // 每个块的最大字符数
  // 为什么选 500：中文文档中，500 字通常是 2-3 个段落，包含 1-2 个完整概念
  chunkSize: number;

  // 相邻块之间的重叠字符数
  // 为什么需要重叠：防止关键信息恰好落在两个块的分界处
  chunkOverlap: number;
}

/**
 * 默认分块配置（针对中文优化）
 * 为什么是这个数值：
 *   - 500 字符 ≈ 2-3 个中文段落，语义单元大小合适
 *   - 100 字符重叠 ≈ 1-2 个长句，保证跨块语义不丢失
 *   - 如果文档以英文为主，建议 chunkSize 设为 800-1000
 */
const DEFAULT_CONFIG: ChunkConfig = {
  chunkSize: 500,
  chunkOverlap: 100,
};

/**
 * 对文档数组进行分块
 * 为什么输入是数组：loader 阶段已经按 PDF 页分好了，这里对每页再细分
 *
 * @param documents - 加载后的文档数组
 * @param config - 分块配置（可选，不传则用默认值）
 * @returns 分块后的 DocumentChunk 数组
 */
export async function chunkDocuments(
  documents: Document[],
  config: ChunkConfig = DEFAULT_CONFIG
): Promise<DocumentChunk[]> {
  // 使用 LangChain 的 RecursiveCharacterTextSplitter（递归字符分割器）
  // 为什么选这个分割器："递归"是指它会按优先级尝试不同的分隔符：
  //   第一优先级：\n\n（段落之间）—— 最好的分割点
  //   第二优先级：\n（行之间）
  //   第三优先级：。（中文句号）
  //   第四优先级：.（英文句号）
  //   最后才在字符级别强制分割
  // 这样做的好处：尽量保留自然的语义边界，而不是机械地每 500 字切一刀
  const splitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    // separators: 自定义分隔符优先级
    // 为什么加中文标点：默认的分隔符是英文的，需要加上中文的分隔符
    separators: [
      "\n\n",   // 段落分隔（最优先，因为段落是最自然的语义边界）
      "\n",     // 换行
      "。",     // 中文句号
      "！",     // 中文感叹号
      "？",     // 中文问号
      "；",     // 中文分号
      "，",     // 中文逗号
      ".",      // 英文句号
      "!",      // 英文感叹号
      "?",      // 英文问号
      ";",      // 英文分号
      " ",      // 空格（最后的救急选择）
      "",       // 空字符串 = 字符级别分割（实在没办法时的兜底）
    ],
  });

  console.log(
    `  使用分块参数: chunkSize=${config.chunkSize}, chunkOverlap=${config.chunkOverlap}`
  );

  const allChunks: DocumentChunk[] = [];

  // 对每个文档（每页）分别进行分块
  for (const doc of documents) {
    // 跳过内容太短的文档（如只有标题的空白页）
    // 为什么跳过短文档：1个字符的页面没有检索价值
    if (doc.content.trim().length < 10) {
      continue;
    }

    // 调用 LangChain 的 splitText 进行分块
    // 为什么用 LangChain 的库而不是自己写：
    //   自己写大概 30 行，但边界情况（中英文混排、超长单词、标点处理）很难周全
    const texts = await splitter.splitText(doc.content);

    // 为每个文本片断创建 DocumentChunk
    const chunks: DocumentChunk[] = texts.map(
      (text: string, index: number) => ({
        content: text,
        metadata: {
          // 展开原始文档的所有元数据
          ...doc.metadata,
          // 添加分块特有信息
          chunkIndex: index,
          totalChunks: texts.length,
        },
      })
    );

    allChunks.push(...chunks);
  }

  console.log(
    `  ✅ 分块完成: ${documents.length} 个文档 → ${allChunks.length} 个文本块`
  );

  // 输出分块统计信息，帮助验证参数是否合理
  // 为什么输出统计：如果平均块太小/太大，说明 chunkSize 需要调整
  const avgLength =
    allChunks.reduce((sum, c) => sum + c.content.length, 0) / allChunks.length;
  console.log(`  📊 平均块长度: ${avgLength.toFixed(0)} 字符`);
  console.log(
    `  📊 最短块: ${Math.min(...allChunks.map((c) => c.content.length))} 字符`
  );
  console.log(
    `  📊 最长块: ${Math.max(...allChunks.map((c) => c.content.length))} 字符`
  );

  return allChunks;
}

/**
 * 快速分块——封装了"加载 → 分块"的完整流程
 * 为什么提供这个便捷函数：大多数情况下，用户一步到位，不需要分开调
 *
 * @param documents - 加载后的文档数组
 * @param config - 分块配置
 * @returns 分块后的 DocumentChunk 数组
 */
export async function chunkDocumentsFromPath(
  documents: Document[],
  config?: ChunkConfig
): Promise<DocumentChunk[]> {
  return chunkDocuments(documents, config);
}
```

### 3.4 分块策略对比

| 策略 | 做法 | 适用场景 | 局限性 |
|------|------|----------|--------|
| **固定长度** | 严格按照 N 个字符切 | 英文文章（词边界清晰） | 中文句子被拦腰截断 |
| **递归分割** | 优先用段落/句子边界 | **通用**（本项目使用） | 分隔符顺序需要手动调 |
| **语义分割** | 用另一个小模型判断语义边界 | 高质量要求 | 慢、成本高、实现复杂 |
| **句子分割** | 按句号切，合并到目标长度 | 简单的 FAQ 类文档 | 短句多时效果差 |

---

## Step 4：向量化与存储

### 4.1 什么是向量（Embedding）？——用比喻理解

想象你要给图书馆里的所有书打标签。每本书的内容各不相同，你希望"内容相近的书，标签也相近"。向量就是给每段文字打的"数字标签"——它不是一个词，而是一串数字（通常是 768 或 1536 个）。

比如：

```
"今天天气真好"     → [0.02, -0.15, 0.73, ..., 0.01]  (1536个数字)
"今天阳光明媚"     → [0.03, -0.13, 0.71, ..., 0.02]  ← 和上面很接近！
"股市今日大跌"     → [-0.51, 0.42, -0.12, ..., 0.33] ← 和上面差异很大
```

"相近的文本 → 相近的向量"这个性质，使得我们可以：
1. 把用户的查询也转成向量
2. 在向量库里找到距离最近的几个向量
3. 它们对应的文本，就是和用户问题最相关的内容

### 4.2 ChromaDB 简介

ChromaDB 是一个开源的向量数据库。你可以把它理解为一个"能按相似度搜索的数据库"。

- **嵌入数据库**：以向量的方式存储数据
- **集合（Collection）**：数据的逻辑分组，一个项目一个集合
- **元数据过滤**：可以按文件名、页码等条件筛选

### 4.3 实现向量化模块

创建 `src/embedder.ts`：

```typescript
//  =================================================================
//  embedder.ts —— 向量化模块
//  职责：将文本转换为向量（embedding）
//  为什么独立成模块：嵌入模型可以切换（OpenAI/本地模型/其他），
//  接口统一，方便未来替换嵌入提供商
//  =================================================================

import OpenAI from "openai";

// 初始化 OpenAI 客户端
// 为什么在这里初始化：整个应用的 embedding 操作共用这一个实例
// 注意：apiKey 通过环境变量传入，调用前需确保 OPENAI_API_KEY 已设置
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * 嵌入配置
 */
export interface EmbedConfig {
  // 使用的嵌入模型名称
  // 为什么选 text-embedding-3-small：
  //   1. 性价比高：$0.02/百万token（ada-002 是 $0.10）
  //   2. 质量好：MTEB 基准测试中中文表现优秀
  //   3. 维度灵活：可以指定输出维度（如 512 而不是默认 1536）
  model: string;

  // 输出维度的最大值（text-embedding-3-small 支持 512/1536）
  // 为什么可以降低维度：减少存储和计算成本，检索质量下降很小
  // 512 维和 1536 维的检索精度差异约 1-2%
  dimensions?: number;
}

const DEFAULT_EMBED_CONFIG: EmbedConfig = {
  model: "text-embedding-3-small",
  // 使用 512 维而不是默认的 1536 维——降低成本，精度几乎不变
  dimensions: 512,
};

/**
 * 将文本数组转换为向量数组
 * 为什么入参是数组：批量处理比逐个调用快很多（减少 HTTP 请求次数）
 *
 * @param texts - 待向量化的文本数组
 * @param config - 嵌入配置
 * @returns 向量数组（每个向量是一个 number[]）
 */
export async function embedTexts(
  texts: string[],
  config: EmbedConfig = DEFAULT_EMBED_CONFIG
): Promise<number[][]> {
  // 空数组直接返回
  if (texts.length === 0) return [];

  console.log(`  正在向量化 ${texts.length} 段文本...`);

  try {
    // 调用 OpenAI Embeddings API
    // 为什么一次传多条文本：API 支持批量输入，减少网络往返
    const response = await openai.embeddings.create({
      model: config.model,
      input: texts,
      // dimensions 只在 text-embedding-3 系列模型下有效
      // 为什么设置：$0.02/百万token 按输入计费，降低输出维度不影响费用但减少存储
      dimensions: config.dimensions as number,
    });

    // 提取向量：OpenAI 返回的结果按输入顺序排列
    // 为什么保持顺序：后续存储时需要将 vector 和正确的 chunk 对应上
    const vectors = response.data.map((item) => item.embedding);

    console.log(`  ✅ 向量化完成（${vectors.length} 个向量）`);
    return vectors;
  } catch (error) {
    console.error(`  ❌ 向量化失败: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * 将单个查询文本转换为向量
 * 为什么单独封装一个单文本函数：用户提问时只需要向量化一个问题
 *
 * @param text - 查询文本（用户的提问）
 * @param config - 嵌入配置
 * @returns 向量
 */
export async function embedQuery(
  text: string,
  config: EmbedConfig = DEFAULT_EMBED_CONFIG
): Promise<number[]> {
  const vectors = await embedTexts([text], config);
  return vectors[0];
}
```

### 4.4 实现向量存储模块

创建 `src/store.ts`：

```typescript
//  =================================================================
//  store.ts —— 向量数据库操作模块
//  职责：将分块后的文档存储到 ChromaDB，包括向量、文本和元数据
//  为什么用 ChromaDB：本地运行、无需配置、开源免费
//  =================================================================

import { ChromaClient } from "chromadb";
import type { DocumentChunk } from "./types";

// 初始化 ChromaDB 客户端
// 为什么不传参数：默认连接 http://localhost:8000，与本地 ChromaDB 服务端通信
const chromaClient = new ChromaClient();

// 集合名称——一个项目用一个集合
// 为什么用固定名称：简化操作，单用户场景不需要动态创建集合
const COLLECTION_NAME = "knowledge_base";

/**
 * 初始化存储（创建或获取集合）
 * 为什么需要初始化：首次运行时集合不存在，需要创建；后续运行时获取已有集合
 * 这个函数应该在程序启动时调用
 */
export async function initializeStore() {
  try {
    // 尝试获取已有集合
    // 为什么先获取：如果集合已经存在（第二次启动），直接复用，不重建
    await chromaClient.getCollection({ name: COLLECTION_NAME });
    console.log(`  ✅ 连接到已有集合: ${COLLECTION_NAME}`);
  } catch {
    // 集合不存在，创建新的
    // 第一次运行时走到这里
    await chromaClient.createCollection({ name: COLLECTION_NAME });
    console.log(`  ✅ 创建新集合: ${COLLECTION_NAME}`);
  }
}

/**
 * 将文档块存入向量数据库
 * 这个函数做了四件事：提取文本、提取ID、提取元数据、批量存储
 *
 * @param chunks - 分块后的文档块数组
 * @param vectors - 对应的向量数组（顺序必须和 chunks 一致）
 */
export async function storeChunks(
  chunks: DocumentChunk[],
  vectors: number[][]
) {
  // 数据校验：chunks 和 vectors 必须一一对应
  // 为什么严格校验：如果数量不对，后面的映射就会错乱，导致检索结果张冠李戴
  if (chunks.length !== vectors.length) {
    throw new Error(
      `数据不匹配: chunks 有 ${chunks.length} 个，但 vectors 有 ${vectors.length} 个`
    );
  }

  if (chunks.length === 0) {
    console.log("  ⚠️  没有内容需要存储");
    return;
  }

  // 获取集合
  const collection = await chromaClient.getCollection({
    name: COLLECTION_NAME,
  });

  // 准备批量存储所需的数据
  // 为什么批量：一次传 100 条比 100 次传 1 条快 10 倍以上

  // ids: 每个块的唯一标识符
  // 为什么用 "文件名-页码-块序号" 格式：
  //   1. 全局唯一（同一文件不同页、不同块都不会冲突）
  //   2. 人类可读（调试时看到 ID 就知道来自哪个文件的哪个位置）
  //   3. 支持幂等（同名文件重新上传时会覆盖而不是重复）
  const ids = chunks.map((chunk) => {
    const source = chunk.metadata.source.replace(/\.[^.]+$/, ""); // 移除后缀
    const page = chunk.metadata.page ? `-p${chunk.metadata.page}` : "";
    const index = `-c${chunk.metadata.chunkIndex}`;
    return `${source}${page}${index}`;
  });

  // documents: 文本内容
  const documents = chunks.map((chunk) => chunk.content);

  // metadatas: 每个块附带的元数据（来源、页码等）
  // 为什么存储元数据：检索时需要知道每个匹配块的出处信息
  const metadatas = chunks.map((chunk) => ({
    source: chunk.metadata.source,
    page: chunk.metadata.page?.toString() || "",
    chunkIndex: chunk.metadata.chunkIndex.toString(),
    totalChunks: chunk.metadata.totalChunks.toString(),
    fileType: chunk.metadata.fileType || "",
  }));

  // 批量添加到 ChromaDB
  // ChromaDB 的 upsert 操作：如果 ID 已存在则更新，否则插入
  // 为什么用 add 而不是 upsert：我们用新 ID，不会冲突
  await collection.add({
    ids,
    embeddings: vectors,
    documents,
    metadatas,
  });

  console.log(`  ✅ 已存储 ${chunks.length} 个文档块到向量数据库`);
}

/**
 * 清空知识库——删除集合中的所有数据
 * 为什么需要清空：重新导入文档前，需要清理旧数据避免重复
 * 实现方式：删除旧集合并创建新的（因为没有 deleteAll 的简单 API）
 */
export async function clearStore() {
  try {
    await chromaClient.deleteCollection({ name: COLLECTION_NAME });
    console.log(`  ✅ 已清空集合: ${COLLECTION_NAME}`);
  } catch {
    // 如果集合本身就不存在，忽略错误
    // 为什么忽略：第一次使用就调 clear 也不会报错
    console.log(`  ℹ️  集合不存在，无需清空`);
  }
  // 重新创建空集合
  await chromaClient.createCollection({ name: COLLECTION_NAME });
}

/**
 * 获取集合中的文档块数量
 * 为什么提供这个：让用户知道知识库里存了多少条数据
 */
export async function getStoreCount(): Promise<number> {
  try {
    const collection = await chromaClient.getCollection({
      name: COLLECTION_NAME,
    });
    return await collection.count();
  } catch {
    return 0;
  }
}

/**
 * 查看知识库中的一些样本数据（调试用）
 * 为什么需要：在不查数据库 UI 的情况下，快速验证数据是否正确存入了
 */
export async function peekStore(limit: number = 5) {
  try {
    const collection = await chromaClient.getCollection({
      name: COLLECTION_NAME,
    });
    const result = await collection.peek({ limit });
    return result;
  } catch {
    console.log("  ℹ️  集合为空或不存在");
    return null;
  }
}
```

### 4.5 验证存储——一条重要的检查

在存入数据后，你应该立即做一个"烟雾测试"（smoke test）：

```
我问一个肯定在文档里的问题 → 检索 → 看返回的内容对不对劲
```

如果检索返回的内容和你的文档无关，说明两个环节出了问题：
1. 向量化：文本在传给 embedding API 前可能是乱码
2. 存储：数据 ID 和向量对应关系可能乱了

---

## Step 5：检索器

### 5.1 检索器的工作原理

检索就是将用户的查询转换为向量，然后在向量数据库中查找最相似的块。

```
用户查询："上周会议的决议是什么？"
     ↓
  embedQuery("上周会议的决议是什么？")
     ↓
  [0.12, -0.34, 0.56, ..., 0.78]  ← 查询向量
     ↓
  在 ChromaDB 中计算余弦相似度
     ↓
  返回 Top-K 个最相似的文本块
```

### 5.2 实现检索器

创建 `src/retriever.ts`：

```typescript
//  =================================================================
//  retriever.ts —— 检索器
//  职责：根据用户查询，从向量数据库中检索最相关的文档块
//  为什么独立成模块：检索策略可以独立优化（加过滤、加重排等），不影响其他模块
//  =================================================================

import { ChromaClient } from "chromadb";
import { embedQuery } from "./embedder";
import type { SearchResult, DocumentChunk } from "./types";

const chromaClient = new ChromaClient();
const COLLECTION_NAME = "knowledge_base";

/**
 * 检索配置
 */
export interface RetrieveConfig {
  // 最多返回多少个结果
  // 为什么不是越大越好：返回太多会给 LLM 塞入大量噪音，影响回答质量
  maxResults: number;

  // 最低相似度阈值（0-1），低于此值的结果直接丢弃
  // 为什么要设阈值：相似度 0.2 的内容几乎无关，丢给 LLM 只会误导它
  // 调参经验：
  //   - 0.7 以上：高度相关，必须包含
  //   - 0.5-0.7：可能相关，视情况保留
  //   - 0.5 以下：大概率不相关，果断丢弃
  scoreThreshold: number;
}

const DEFAULT_RETRIEVE_CONFIG: RetrieveConfig = {
  maxResults: 5,
  scoreThreshold: 0.5,
};

/**
 * 检索与查询最相关的文档块
 * 
 * @param query - 用户的自然语言查询
 * @param config - 检索配置（可选）
 * @returns 按相似度降序排列的检索结果
 */
export async function search(
  query: string,
  config: RetrieveConfig = DEFAULT_RETRIEVE_CONFIG
): Promise<SearchResult[]> {
  console.log(`  🔍 检索中: "${query}"`);

  // 第一步：将查询向量化
  // 为什么用和存储时相同的 embedding 模型：
  //   不同的模型生成的向量在不同的"向量空间"中，不能混用
  //   就像用中文标签查找英文分类的图书馆——标签体系不一样，搜不到东西
  const queryVector = await embedQuery(query);

  // 第二步：从 ChromaDB 获取集合
  const collection = await chromaClient.getCollection({
    name: COLLECTION_NAME,
  });

  // 第三步：执行相似度检索
  // queryEmbeddings: 查询向量
  // nResults: 返回多少个结果（这里多取一些，后续可以过滤和排序）
  // 为什么多取一些：先宽松地取了，再用 scoreThreshold 过滤，比取少了再补取效率高
  const results = await collection.query({
    queryEmbeddings: [queryVector],
    nResults: Math.max(config.maxResults * 2, 10),
  });

  // ChromaDB 返回格式：
  //   results.ids[0] = ["id1", "id2", ...]
  //   results.documents[0] = ["doc1", "doc2", ...]
  //   results.metadatas[0] = [{source: ...}, ...]
  //   results.distances[0] = [0.12, 0.34, ...]  ← 距离值（越小越相似）
  // 为什么 results 的结构是数组里套数组：
  //   ChromaDB 支持一次发送多个查询，外层数组对应每个查询

  const searchResults: SearchResult[] = [];

  // 遍历检索结果
  for (let i = 0; i < results.ids[0].length; i++) {
    // 将 ChromaDB 的距离值转换为相似度分数
    // ChromaDB 默认使用 L2（欧几里得）距离，值越小表示越相似
    // 转换为相似度：1 / (1 + distance)
    // 为什么这样转换：用户理解的"分数"应该是越高越好，而且 0-1 范围更直观
    const distance = results.distances![0][i];
    const score = 1 / (1 + distance);

    // 过滤低分结果
    // 为什么在循环里过滤而不是先构建数组再过滤：减少不必要的对象创建
    if (score < config.scoreThreshold) {
      continue;
    }

    const metadata = results.metadatas![0][i];
    const content = results.documents![0][i];

    // 构建 DocumentChunk
    const chunk: DocumentChunk = {
      content,
      metadata: {
        source: metadata.source as string,
        page: metadata.page ? parseInt(metadata.page as string) : undefined,
        chunkIndex: parseInt(metadata.chunkIndex as string),
        totalChunks: parseInt(metadata.totalChunks as string),
        fileType: metadata.fileType as string,
      },
    };

    searchResults.push({ chunk, score });
  }

  // 按相似度降序排列，确保最相关的结果在前面
  searchResults.sort((a, b) => b.score - a.score);

  // 限制返回数量
  const finalResults = searchResults.slice(0, config.maxResults);

  console.log(
    `  ✅ 找到 ${finalResults.length} 个相关结果（原始 ${searchResults.length} 个，过滤后保留）`
  );

  // 打印每个结果的摘要，方便调试
  finalResults.forEach((result, index) => {
    const { source, page } = result.chunk.metadata;
    const preview =
      result.chunk.content.substring(0, 60).replace(/\n/g, " ") + "...";
    console.log(
      `    [${index + 1}] ${source}${page ? ` (第${page}页)` : ""} - 分数: ${result.score.toFixed(3)} - "${preview}"`
    );
  });

  return finalResults;
}

/**
 * 简单检索——返回原始格式（用于需要直接操作 ChromaDB 返回值的场景）
 */
export async function searchRaw(
  query: string,
  nResults: number = 5
): Promise<any> {
  const queryVector = await embedQuery(query);
  const collection = await chromaClient.getCollection({
    name: COLLECTION_NAME,
  });
  return await collection.query({
    queryEmbeddings: [queryVector],
    nResults,
  });
}
```

### 5.3 关于重排序

你可能会在一些高级 RAG 系统中看到"重排序"（re-ranking）这个步骤。它指的是：先用向量检索召回 Top-20 的结果（宽松），然后用一个更智能的模型对这些结果重新打分和排序，只保留 Top-5。

**什么时候需要重排序？**
- 知识库很大（>10,000 个块）
- 用户提问方式多样（口语化、多语言混用）
- 对准确率要求很高（医疗、法律领域）

**什么时候不需要？**
- 知识库较小（<5,000 个块）——向量检索已经够准
- 用户提问很直接（关键词明确）
- 追求响应速度——重排序多一次 API 调用，增加 1-2 秒延迟

对于这个项目，我们不加重排序，保持简单高效。

---

## Step 6：问答引擎

### 6.1 问答引擎——整个系统的"大脑"

前面做的所有事情（加载、分块、向量化、检索）都是"准备原材料"。问答引擎是真正"做菜"的地方——它把原材料（检索到的文本块）和用户的问题一起烹饪成答案。

### 6.2 提示词为什么重要？

同样的检索结果，不同的提示词可以产生完全不同的回答质量。我们来看两个对比：

**糟糕的提示词：**
```
根据以下内容回答问题：{context}
问题：{query}
```
这个提示词的问题：
- 没有告诉模型"如果资料里没有答案怎么办"——模型会开始编造
- 没有要求引用来源——用户无法验证答案真实性
- 没有说明回答风格——可能过于冗长或过于简短

**改进后的提示词（我们使用的）：**
不仅定义了任务，还定义了"边界"（资料不足时要承认）和"形式"（必须引用来源）。

### 6.3 实现问答引擎

创建 `src/qa-engine.ts`：

```typescript
//  =================================================================
//  qa-engine.ts —— 问答引擎
//  职责：组装 RAG 提示词，调用 LLM 生成答案
//  这是整个系统最核心的模块——前面的所有工作都在为这里服务
//  =================================================================

import OpenAI from "openai";
import { search } from "./retriever";
import type { QARequest, QAResponse, SearchResult } from "./types";

// 初始化 OpenAI 客户端（用于 Chat Completion）
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * RAG 提示词模板
 * 为什么这样设计提示词：
 *   1. 角色定义（"知识库助手"）：让模型理解自己的身份和语气
 *   2. 行为规则（"只使用参考资料"）：建立 Grounding——防止幻觉的核心手段
 *   3. 边界处理（"资料不足时明确说明"）：诚实比编造更重要
 *   4. 引用要求：可追溯性是知识库的核心价值
 *   5. 结构化的上下文区：清晰的资料区域让模型知道哪些是"事实"
 *
 * {context}：检索到的参考资料
 * {query}：用户的原始问题
 *
 * Grounding 原理：
 *   大模型本质上是"文本补全引擎"，它倾向于"说点什么"而不是"说不知道"。
 *   如果不明确限制，当资料不足时它会本能地"脑补"合理但虚构的内容。
 *   通过在提示词中明确"如果资料不足，就说不知道"，我们给了模型一个
 *   体面的"exit strategy"——承认无知也是符合指示的行为。
 */
const RAG_PROMPT = `你是一个严谨、诚实的知识库助手。你的任务是基于提供的参考资料回答问题。

## 核心规则（必须遵守）
1. **只使用参考资料中的信息**来回答问题
2. 如果参考资料包含了足够的信息，请详细、准确地回答
3. 如果参考资料不足以回答问题，请明确说：
   "根据已有资料，我无法回答这个问题。"并解释资料中缺失了什么
4. **绝对不要编造**参考资料中没有的事实、数据或结论
5. 如果你使用了某条资料，请用 [来源：文件名] 的格式标注来源

## 回答要求
- 条理清晰，使用中文回答
- 可以分段、分点，但核心观点要突出
- 如果有多个参考资料涉及同一话题，尝试综合它们的信息
- 如果有矛盾之处，请指出并分别引用

## 参考资料
{context}

## 用户问题
{query}

## 你的回答（请严格遵守上述规则）`;

/**
 * 构建上下文——把检索到的文档块拼成 LLM 可读的格式
 * 为什么要格式化：把零散的块拼成统一结构的资料区，方便 LLM 解析和引用
 *
 * @param searchResults - 检索到的结果列表
 * @returns 格式化后的上下文字符串
 */
function buildContext(searchResults: SearchResult[]): string {
  if (searchResults.length === 0) {
    return "（没有找到相关的参考资料）";
  }

  // 为每个结果块添加编号和来源标注
  // 为什么加编号：[来源1]、[来源2] 比直接写文件名更简洁，LLM 引用也更自然
  return searchResults
    .map((result, index) => {
      const { source, page } = result.chunk.metadata;
      // 构建来源描述
      const sourceDesc = page
        ? `${source}（第${page}页）`
        : source;

      // 格式：[编号] 来源描述\n内容...
      // 为什么用 --开始/--结束：用醒目的分隔符告诉 LLM 这是一个独立的资料块
      return `\n--- 参考资料 [${index + 1}] 来自 ${sourceDesc} ---\n${result.chunk.content}\n--- 参考资料 [${index + 1}] 结束 ---\n`;
    })
    .join("\n");
}

/**
 * 构建完整的提示词
 * 为什么单独封装：可以在这里做 token 计数和截断，防止超出模型上下文限制
 *
 * @param query - 用户问题
 * @param context - 格式化后的上下文
 * @returns 完整的提示词字符串
 */
function buildPrompt(query: string, context: string): string {
  // 替换提示词模板中的占位符
  return RAG_PROMPT.replace("{context}", context).replace("{query}", query);
}

/**
 * 执行问答——完整流程：检索 → 组装提示词 → LLM 生成
 *
 * @param request - QA 请求
 * @returns QA 响应（包含答案、来源引用、检索结果）
 */
export async function askQuestion(request: QARequest): Promise<QAResponse> {
  const { query, maxResults = 5, scoreThreshold = 0.5 } = request;

  console.log(`\n📝 问题: ${query}\n`);

  // 步骤 1：检索相关文档块
  // 为什么先检索：先通过向量搜索缩小范围，大幅减少后续 LLM 处理的 token 量
  const searchResults = await search(query, { maxResults, scoreThreshold });

  // 步骤 2：构建上下文（将检索结果格式化为 LLM 可读的结构）
  const context = buildContext(searchResults);

  // 步骤 3：组装完整提示词
  const prompt = buildPrompt(query, context);

  // 步骤 4：调用 LLM 生成答案
  console.log(`  🤖 正在生成回答...`);

  try {
    const completion = await openai.chat.completions.create({
      // 模型选择：
      //   gpt-4o：质量和速度的最佳平衡，推荐
      //   gpt-4o-mini：更便宜更快，简单问题完全够用
      //   gpt-4：最聪明但最贵，复杂推理专用
      model: "gpt-4o-mini",

      // 消息：只有一条 user 消息，不用 system 消息
      // 为什么把角色定义和行为规则直接放在 user 消息里：
      //   1. system 消息在部分模型（非 OpenAI）中可能被忽略
      //   2. user 消息中的指令对大多数模型同样有效
      //   3. 单一消息更简单，调试时直观
      messages: [{ role: "user", content: prompt }],

      // temperature: 控制随机性，范围 0-2
      // 为什么设 0.3 而不是 0：
      //   问答任务需要准确性和一致性，低 temperature 减少随机性
      //   但 0 会让回答过于死板，0.3 保持一点灵活性让语言更自然
      temperature: 0.3,

      // max_tokens: 限制回答最大长度
      // 为什么设 1000：太短可能截断答案，太长浪费 token
      max_tokens: 1000,
    });

    // 提取回答内容
    const answerContent =
      completion.choices[0].message.content || "（模型未返回回答）";

    console.log(`  ✅ 回答生成完毕\n`);

    // 步骤 5：提取来源引用（提供给用户查看）
    const sources = searchResults.map((result) => ({
      source: result.chunk.metadata.source,
      page: result.chunk.metadata.page,
      // 截取前 100 字作为预览
      snippet: result.chunk.content.substring(0, 100),
      score: result.score,
    }));

    return {
      answer: answerContent,
      sources,
      searchResults,
    };
  } catch (error) {
    console.error(`  ❌ 生成回答失败: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * 获取提示词模板（供用户理解和学习用）
 * 为什么暴露：让用户看到完整的提示词，理解 RAG 是如何工作的
 */
export function getPromptTemplate(): string {
  return RAG_PROMPT;
}
```

### 6.4 提示词工程——本项目最重要的教学内容

**为什么这个提示词结构有效？**

1. **角色锚定**："严谨、诚实的知识库助手"——三个字定义了模型的"人设"，影响整体语气和回答风格

2. **行为边界（Grounding）**：第 4 条"绝对不要编造"是最重要的一条。LLM 有一种"讨好用户"的倾向——当资料不足时，它宁可编一个看起来合理的答案，也不愿说"不知道"。我们必须用强烈的否定词（"绝对不要"）打破这种倾向。

3. **明确的 exit strategy**：第 3 条给了模型一个"体面的退出方式"——说"我无法回答"并解释原因。这让模型知道：承认无知也是正确行为。

4. **结构化**：用 `##` 标题和编号分隔，帮助模型理解提示词的结构层次。

5. **来源引用**：要求标注文件名，这不仅是给用户看的，也反过来约束模型——它知道自己的回答会被"查证"，所以更不敢编造。

---

## Step 7：命令行界面

### 7.1 实现 CLI

创建 `src/index.ts`（主入口文件）：

```typescript
//  =================================================================
//  index.ts —— 主入口 / 命令行交互界面
//  职责：启动程序、处理用户输入、协调各模块
//  为什么这是入口文件：将所有模块串联起来，暴露给用户的唯一界面
//  =================================================================

// readline：Node.js 内置模块，用于创建命令行交互界面
// 为什么用 readline：零依赖，够用，支持逐行读取用户输入
import * as readline from "readline";
import * as path from "path";
import * as fs from "fs";

// 加载环境变量——必须在所有其他 import 之前
// 为什么先加载：其他模块在初始化时可能就需要 API Key
import * as dotenv from "dotenv";
dotenv.config();

// 导入各功能模块
import { loadDirectory, loadSingleFile } from "./loader";
import { chunkDocuments } from "./chunker";
import { embedTexts } from "./embedder";
import { initializeStore, storeChunks, clearStore, getStoreCount } from "./store";
import { askQuestion } from "./qa-engine";
import type { QAResponse } from "./types";

//  =================================================================
//  配置
//  =================================================================

// 文档目录——用户把要导入的文档放在这个文件夹里
// 为什么用相对路径：方便，无论项目在哪里都能找到
const DOCUMENTS_DIR = path.resolve(__dirname, "../documents");

//  =================================================================
//  全局状态
//  =================================================================

// 保存最后一次问答的结果，用于 :sources 命令查看来源
// 为什么需要保留历史状态：用户回答完一个问题后可能会想要查看来源细节
let lastResponse: QAResponse | null = null;

//  =================================================================
//  工具函数
//  =================================================================

/**
 * 导入文档流程——将 documents 目录下的所有文档导入知识库
 * 为什么需要这个函数：用户新增文档后，需要一键导入
 * 流程：清空旧数据 → 加载文档 → 分块 → 向量化 → 存储
 */
async function importDocuments() {
  console.log("\n📂 开始导入文档...\n");

  // 检查 documents 目录是否存在
  if (!fs.existsSync(DOCUMENTS_DIR)) {
    // 目录不存在，自动创建
    // 为什么不直接报错：给用户一个明显的提示，减少挫败感
    fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
    console.log(
      `⚠️  文档目录 "${DOCUMENTS_DIR}" 不存在，已自动创建。`
    );
    console.log("   请将需要导入的文档放入该目录后重新运行 :import\n");
    return;
  }

  try {
    // 步骤 1：清空知识库旧数据
    // 为什么先清空：避免新旧数据混合，保证知识库数据的一致性
    // 注意：这会删除所有已存储的文档块！如果只需要增量添加，要用更细粒度的操作
    console.log("步骤 1/5: 清空知识库...");
    await clearStore();
    await initializeStore();

    // 步骤 2：加载文档——从文件系统读取原始内容
    console.log("\n步骤 2/5: 加载文档...");
    const documents = await loadDirectory(DOCUMENTS_DIR);

    if (documents.length === 0) {
      console.log("⚠️  没有找到可导入的文档（支持格式: .txt, .md, .pdf）");
      console.log(`   请将文档放入 "${DOCUMENTS_DIR}" 目录\n`);
      return;
    }

    // 步骤 3：分块——将长文档切成固定大小的语义块
    console.log("\n步骤 3/5: 文本分块...");
    const chunks = await chunkDocuments(documents);

    if (chunks.length === 0) {
      console.log("⚠️  没有可用的文本块（文档内容可能太短或为空）\n");
      return;
    }

    // 步骤 4：向量化——将文本转为向量
    // 为什么文本切片后先提取内容数组：embedTexts 接受 string[]，需要统一格式
    console.log("\n步骤 4/5: 向量化...");
    const texts = chunks.map((chunk) => chunk.content);
    const vectors = await embedTexts(texts);

    // 步骤 5：存储——将向量和文本存入 ChromaDB
    console.log("\n步骤 5/5: 存储到向量数据库...");
    await storeChunks(chunks, vectors);

    // 导入完成，显示统计
    const count = await getStoreCount();
    console.log(`\n🎉 导入完成！知识库现有 ${count} 条记录。\n`);
  } catch (error) {
    console.error(`\n❌ 导入失败: ${(error as Error).message}`);
    console.error("   请检查:"));
    console.error("   1. documents 目录下是否有文件？");
    console.error("   2. .env 文件中的 OPENAI_API_KEY 是否有效？");
    console.error("   3. ChromaDB 服务是否在运行？\n");
  }
}

/**
 * 处理用户提问
 */
async function handleAsk(query: string) {
  // 检查知识库是否有数据
  const count = await getStoreCount();
  if (count === 0) {
    console.log(
      '⚠️  知识库为空！请先使用 ":import" 导入文档。\n'
    );
    return;
  }

  try {
    // 调用问答引擎
    lastResponse = await askQuestion({ query });

    // 输出答案
    console.log("═══════════════════════════════════════════");
    console.log("📋 回答：\n");
    console.log(lastResponse.answer);
    console.log("\n═══════════════════════════════════════════");

    // 输出简短的来源摘要
    console.log(`\n📎 参考了 ${lastResponse.sources.length} 个来源：`);
    lastResponse.sources.forEach((s, i) => {
      console.log(
        `   [${i + 1}] ${s.source}${s.page ? ` (第${s.page}页)` : ""} (相似度: ${s.score.toFixed(2)})`
      );
    });
    console.log('   输入 ":sources" 查看更多来源细节\n');
  } catch (error) {
    console.error(`\n❌ 提问失败: ${(error as Error).message}\n`);
  }
}

/**
 * 显示来源详情
 */
function showSources() {
  if (!lastResponse) {
    console.log("⚠️  还没有进行过问答，无法显示来源。请先提问。\n");
    return;
  }

  console.log("\n═══════════════════════════════════════════");
  console.log("📎 来源详情：\n");

  lastResponse.sources.forEach((s, i) => {
    console.log(`[${i + 1}] ${s.source}${s.page ? ` (第${s.page}页)` : ""}`);
    console.log(`   相似度: ${s.score.toFixed(3)}`);
    console.log(`   预览: ${s.snippet}...`);
    console.log("");
  });
  console.log("═══════════════════════════════════════════\n");
}

/**
 * 上传单个文件到 documents 目录
 */
async function handleUpload(filePath: string) {
  if (!fs.existsSync(filePath)) {
    console.log(`❌ 文件不存在: ${filePath}\n`);
    return;
  }

  // 检查文件格式
  const ext = path.extname(filePath).toLowerCase();
  if (![".txt", ".md", ".pdf"].includes(ext)) {
    console.log(`❌ 不支持的文件格式: ${ext}（支持 .txt, .md, .pdf）\n`);
    return;
  }

  // 确保 documents 目录存在
  if (!fs.existsSync(DOCUMENTS_DIR)) {
    fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
  }

  // 复制文件到 documents 目录
  const fileName = path.basename(filePath);
  const destPath = path.join(DOCUMENTS_DIR, fileName);
  fs.copyFileSync(filePath, destPath);
  console.log(`✅ 文件已复制到: ${destPath}`);
  console.log('   请使用 ":import" 将其导入知识库\n');
}

/**
 * 显示帮助信息
 */
function showHelp() {
  console.log("\n═══════════════════════════════════════════");
  console.log("📚 个人知识库问答系统 - 使用说明");
  console.log("═══════════════════════════════════════════\n");
  console.log("命令列表：");
  console.log('  :ask <问题>     向知识库提问');
  console.log('  :import          导入 documents 目录下的所有文档');
  console.log('  :upload <路径>   上传一个文件到 documents 目录');
  console.log('  :sources         显示上次回答的来源详情');
  console.log('  :count           查看知识库中的文档块数量');
  console.log('  :help            显示此帮助信息');
  console.log('  :quit            退出程序\n');
  console.log("使用步骤：");
  console.log("  1. 将文档放入 documents/ 目录（或用 :upload）");
  console.log("  2. 运行 :import 导入文档");
  console.log("  3. 使用 :ask <问题> 开始提问\n");
  console.log("═══════════════════════════════════════════\n");
}

//  =================================================================
//  主程序
//  =================================================================

async function main() {
  // 检查必要的环境变量
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ 错误：未设置 OPENAI_API_KEY");
    console.error("   请在 .env 文件中配置你的 OpenAI API Key\n");
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════");
  console.log("📚 个人知识库问答系统");
  console.log("═══════════════════════════════════════════");
  console.log('输入 ":help" 查看可用命令\n');

  // 初始化向量数据库连接
  try {
    await initializeStore();
    const count = await getStoreCount();
    console.log(`ℹ️  知识库状态: ${count} 条记录`);
    if (count === 0) {
      console.log(
        '   请将文档放入 documents/ 目录后运行 ":import" 导入\n'
      );
    } else {
      console.log('   输入 ":ask <问题>" 开始提问\n');
    }
  } catch (error) {
    console.error("❌ 无法连接到 ChromaDB");
    console.error("   请确保 ChromaDB 服务已启动: chroma run\n");
    process.exit(1);
  }

  // 创建 readline 交互界面
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "🤔 > ",
  });

  rl.prompt();

  // 监听用户输入
  rl.on("line", async (line: string) => {
    const input = line.trim();

    // 空行忽略
    if (!input) {
      rl.prompt();
      return;
    }

    // 解析命令
    if (input.startsWith(":ask ")) {
      // 提取问题（去掉 ":ask " 前缀）
      const query = input.slice(5).trim();
      if (!query) {
        console.log("⚠️  请输入问题，例如：:ask 机器学习是什么？\n");
      } else {
        await handleAsk(query);
      }
    } else if (input === ":import") {
      await importDocuments();
    } else if (input.startsWith(":upload ")) {
      const filePath = input.slice(8).trim();
      await handleUpload(filePath);
    } else if (input === ":sources") {
      showSources();
    } else if (input === ":count") {
      const count = await getStoreCount();
      console.log(`ℹ️  知识库当前有 ${count} 条文档记录\n`);
    } else if (input === ":help") {
      showHelp();
    } else if (input === ":quit") {
      console.log("👋 再见！");
      rl.close();
      process.exit(0);
    } else {
      console.log(
        `⚠️  未知命令: "${input}"。输入 ":help" 查看可用命令。\n`
      );
    }

    rl.prompt();
  });

  // 处理 Ctrl+C（SIGINT）
  rl.on("SIGINT", () => {
    console.log("\n👋 再见！");
    rl.close();
    process.exit(0);
  });
}

// 启动主程序
// 为什么用 .catch 处理顶层错误：main 是 async 函数，未捕获的 Promise rejection
// 如果不处理，Node.js 会打印警告但不会退出，可能让用户困惑
main().catch((error) => {
  console.error("程序异常退出:", error.message);
  process.exit(1);
});
```

### 7.2 配置 package.json 脚本

在 `package.json` 中添加启动脚本：

```json
{
  "scripts": {
    // 启动 CLI 界面
    // 为什么用 tsx：直接运行 TypeScript，无需事先编译
    "start": "tsx src/index.ts",

    // 编译 TypeScript
    "build": "tsc",

    // 先编译再运行（生产模式）
    "start:prod": "tsc && node dist/index.js"
  }
}
```

---

## Step 8：测试与迭代

### 8.1 AI 开发的正确心态

传统的软件开发是**确定性的**：写一个函数 `add(1, 2)`，输出永远是 `3`。

AI 开发是**实验性的**：同样的代码、同样的输入，不同的提示词、不同的分块参数，可能得到完全不同的回答。你无法通过"代码审查"来判断系统好不好——你必须**实际运行、测试数据、对比结果**。

### 8.2 准备测试数据集

在你的 `data/` 文件夹中准备 2-3 份测试文档（可以是任何内容），然后准备 5 个你知道答案的问题。

**测试文档示例**（`data/测试文档-机器学习.md`）：

```markdown
# 机器学习基础概念

## 什么是机器学习
机器学习是人工智能的一个分支。它赋予计算机在没有明确编程的情况下从数据中学习的能力。
机器学习的核心思想是：通过算法分析数据，找到其中的模式和规律，然后用这些模式对新数据做预测或决策。

## 机器学习的三种类型
### 监督学习
监督学习使用带有标签的训练数据。算法学习输入到输出的映射关系。
常见算法：线性回归、逻辑回归、决策树、随机森林、支持向量机（SVM）。

线性回归用于预测连续值，比如预测房价。它的目标是找到一条直线（或超平面）来最好地拟合数据点。
逻辑回归虽然名字包含"回归"，但它用于分类任务，特别是二分类问题。
支持向量机通过在特征空间中寻找最优超平面来分隔不同类别的数据点。

### 无监督学习
无监督学习使用没有标签的数据。算法自己发现数据中的隐藏结构。
常见算法：K-means聚类、层次聚类、主成分分析（PCA）。
K-means将数据分为K个组，每个组的数据点尽可能相似。
PCA用于降维——将高维数据投影到低维空间，同时保留尽可能多的信息。

### 强化学习
强化学习中，智能体通过与环境交互来学习。它通过试错获得奖励或惩罚，从而学习最优策略。
应用场景：游戏AI（AlphaGo）、机器人控制、推荐系统。
```

### 8.3 测试问题列表

准备如下 5 个测试问题，答案都可以在测试文档中找到：

| 编号 | 问题 | 期望答案要点 | 难度 |
|------|------|-------------|------|
| Q1 | 什么是机器学习？ | 从数据中学习、无需明确编程 | 简单 |
| Q2 | 监督学习和无监督学习有什么区别？ | 有标签 vs 无标签 | 中等 |
| Q3 | SVM 的全称是什么，它做什么？ | 支持向量机、寻找最优超平面 | 简单 |
| Q4 | PCA 的作用是什么？ | 降维、保留信息 | 简单 |
| Q5 | 强化学习用到了哪些实际场景？ | AlphaGo、机器人、推荐系统 | 简单 |

### 8.4 第一轮测试——基线

运行第一轮测试，记录每个问题的回答质量：

```
第一轮测试（基线：chunkSize=500, chunkOverlap=100, scoreThreshold=0.5）

Q1: ✅ 正确——回答完整
Q2: ✅ 正确——区分了有标签 vs 无标签
Q3: ✅ 正确——找到了 SVM 的定义
Q4: ⚠️ 部分——提到了降维，但没有提"保留信息"
Q5: ❌ 遗漏——只提到了 AlphaGo，丢了其他场景
```

### 8.5 迭代一：调整分块参数

Q4 和 Q5 的问题可能是因为分块大小不合适导致的。SVM 的完整信息和强化学习的应用场景可能被切到了不同块中。

**调整**：将 `chunkSize` 从 500 增加到 800，`chunkOverlap` 从 100 增加到 150。

修改 `src/chunker.ts` 中的默认配置：

```typescript
const DEFAULT_CONFIG: ChunkConfig = {
  chunkSize: 800,     // 从 500 改为 800——更大的块包含更完整的语义
  chunkOverlap: 150,  // 从 100 改为 150——更大的重叠保证不丢失跨块信息
};
```

重新导入并测试：

```
第二轮测试（调整后：chunkSize=800, chunkOverlap=150）

Q4: ✅ 正确——现在完整提到了降维和保留信息
Q5: ⚠️ 仍有遗漏——但比上一轮好，提到了两个场景
```

### 8.6 迭代二：调整提示词

Q5 在一轮中只提到 AlphaGo，说明 LLM 倾向于只输出"第一个想到的"例子。这可能是提示词中没有要求"列出所有"。

在提示词的"回答要求"部分增加约束：

```typescript
const RAG_PROMPT = `...

## 回答要求
- 条理清晰，使用中文回答
- 可以分段、分点，但核心观点要突出
- 如果参考资料中列出了多项内容（如多个算法、多个场景），请**全部列出**
- 如果有多个参考资料涉及同一话题，尝试综合它们的信息
- 如果有矛盾之处，请指出并分别引用

...`;
```

第三轮测试：

```
第三轮测试（优化提示词后）

Q5: ✅ 正确——完整列出了 AlphaGo、机器人控制、推荐系统
```

### 8.7 迭代总结

| 轮次 | 变更 | Q1 | Q2 | Q3 | Q4 | Q5 | 总正确率 |
|------|------|----|----|----|----|----|---------|
| 第一轮 | 基线 | ✅ | ✅ | ✅ | ⚠️ | ❌ | 60% |
| 第二轮 | 调整chunkSize | ✅ | ✅ | ✅ | ✅ | ⚠️ | 80% |
| 第三轮 | 优化提示词 | ✅ | ✅ | ✅ | ✅ | ✅ | 100% |

**关键洞察**：这个迭代过程不是"写代码-修bug"的模式，而是"做假设-做实验-看结果-调整假设"的科学方法。每一次调整都基于对失败原因的具体分析：

- Q4 失败 → 怀疑块太小，语义断裂 → 增大 chunkSize → 验证
- Q5 失败 → 怀疑 LLM 不够穷举 → 在提示词中强化要求 → 验证

**这就是 AI 工程师的工作方式：不断提出假设，用实验验证，调整参数，直到系统达到满意的水平。**

---

## Step 9：做成 Web 服务（可选进阶）

### 9.1 为什么要做成 Web 服务？

CLI 适合开发者自己用。但如果想给同事用、或者接入其他系统，Web 服务是必须的。

这个部分是可选的——如果你只想要一个本地使用的工具，到 Step 8 就足够了。

### 9.2 安装 Web 依赖

```bash
npm install express cors
npm install @types/express @types/cors --save-dev
```

### 9.3 实现 Web 服务端

创建 `src/server.ts`：

```typescript
//  =================================================================
//  server.ts —— Express Web 服务
//  职责：将知识库问答系统包装成 HTTP API，支持前端页面
//  为什么用 Express：最流行的 Node.js Web 框架，简单够用
//  =================================================================

import express from "express";
import cors from "cors";
import path from "path";
import * as dotenv from "dotenv";

// 环境变量必须在最开始加载
dotenv.config();

import { initializeStore, getStoreCount } from "./store";
import { askQuestion } from "./qa-engine";

// 创建 Express 应用实例
const app = express();
// 监听端口，可以用环境变量自定义
const PORT = process.env.PORT || 3000;

// 中间件配置
// 为什么需要 cors：前端页面如果部署在不同端口，需要跨域支持
app.use(cors());
// 为什么需要 json 解析：POST 请求的 body 是 JSON 格式
app.use(express.json());
// 提供前端静态文件
// 为什么放在这里：简单项目不需要单独的静态文件服务器
app.use(express.static(path.join(__dirname, "../public")));

//  =================================================================
//  API 路由
//  =================================================================

/**
 * GET /api/health——健康检查接口
 * 为什么需要：启动后快速验证服务是否正常运行
 */
app.get("/api/health", async (req, res) => {
  try {
    const count = await getStoreCount();
    res.json({
      status: "ok",
      documentCount: count,
      message: count > 0 ? "知识库已就绪" : "知识库为空，请先导入文档",
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "服务异常",
    });
  }
});

/**
 * POST /api/ask——问答接口
 * 为什么用 POST 而不是 GET：
 *   1. 问题可能很长（GET URL 有长度限制）
 *   2. 语义上 POST 更适合"创建一个回答"的动作
 */
app.post("/api/ask", async (req, res) => {
  try {
    // 从请求体中提取问题
    const { query } = req.body;

    // 参数验证
    if (!query || typeof query !== "string" || query.trim().length === 0) {
      res.status(400).json({
        error: "请提供有效的问题",
      });
      return;
    }

    // 调用问答引擎
    const response = await askQuestion({ query });

    // 返回结果
    // 为什么同时返回 answer 和 sources：前端需要展示答案和来源引用
    res.json({
      answer: response.answer,
      sources: response.sources,
    });
  } catch (error) {
    console.error("问答失败:", error);
    res.status(500).json({
      error: "问答处理失败",
      details: (error as Error).message,
    });
  }
});

/**
 * 所有未匹配的路径返回前端页面（SPA 支持）
 * 为什么需要：用户直接访问 /about 等路径时，返回 index.html
 */
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

//  =================================================================
//  启动服务
//  =================================================================

async function start() {
  // 检查 API Key
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ 未设置 OPENAI_API_KEY");
    process.exit(1);
  }

  // 初始化向量数据库
  try {
    await initializeStore();
    const count = await getStoreCount();
    console.log(`✅ 知识库已连接，${count} 条记录`);
  } catch (error) {
    console.error("❌ 无法连接 ChromaDB:", (error as Error).message);
    process.exit(1);
  }

  // 启动 HTTP 服务
  app.listen(PORT, () => {
    console.log(`\n🚀 知识库问答服务已启动: http://localhost:${PORT}`);
    console.log(`📋 API 文档:`);
    console.log(`   GET  /api/health  - 健康检查`);
    console.log(`   POST /api/ask     - 提问\n`);
  });
}

start().catch((error) => {
  console.error("启动失败:", error);
  process.exit(1);
});
```

### 9.4 简易前端页面

创建 `public/index.html`：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>个人知识库问答系统</title>
  <style>
    /* 全局样式 */
    /* 为什么用简单的 CSS 而不用框架：学习型项目，框架会分散对核心逻辑的注意力 */
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Microsoft YaHei", sans-serif;
      /* 系统字体栈——在各平台都有最佳显示效果 */
      background: #f5f5f5;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* 顶部标题栏 */
    .header {
      background: #2c3e50;
      color: white;
      padding: 16px 24px;
      font-size: 18px;
      font-weight: 600;
      /* 固定顶部，方便在任何滚动位置查看标题 */
      position: sticky;
      top: 0;
      z-index: 10;
    }

    /* 聊天区域——主要占用空间 */
    .chat-container {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      max-width: 800px;
      margin: 0 auto;
      width: 100%;
    }

    /* 消息气泡通用样式 */
    .message {
      margin-bottom: 20px;
      display: flex;
      flex-direction: column;
    }

    /* 用户消息——右对齐 */
    .message.user {
      align-items: flex-end;
    }

    /* 助手消息——左对齐 */
    .message.assistant {
      align-items: flex-start;
    }

    /* 消息气泡内容 */
    .message-content {
      max-width: 80%;
      padding: 12px 18px;
      border-radius: 12px;
      line-height: 1.6;
      /* 保留换行和空格——RAG 回答通常有格式 */
      white-space: pre-wrap;
      word-break: break-word;
    }

    .message.user .message-content {
      background: #3498db;
      color: white;
      /* 右下角不圆角——视觉上像对话气泡 */
      border-bottom-right-radius: 4px;
    }

    .message.assistant .message-content {
      background: white;
      color: #333;
      /* 添加轻微阴影——让气泡"浮"在背景上 */
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      border-bottom-left-radius: 4px;
    }

    /* 来源引用区域 */
    .sources {
      margin-top: 8px;
      font-size: 12px;
      color: #888;
      padding: 0 18px;
    }

    .source-item {
      display: inline-block;
      background: #ecf0f1;
      padding: 2px 8px;
      border-radius: 10px;
      margin-right: 6px;
      margin-top: 4px;
      /* 小标签样式——视觉上区分引用和正文 */
    }

    /* 输入区域——固定在底部 */
    .input-container {
      background: white;
      border-top: 1px solid #e0e0e0;
      padding: 16px 20px;
      display: flex;
      gap: 12px;
      max-width: 800px;
      margin: 0 auto;
      width: 100%;
    }

    /* 输入框 */
    .input-container input {
      flex: 1;
      padding: 10px 16px;
      border: 1px solid #ddd;
      border-radius: 20px;
      font-size: 15px;
      outline: none;
      /* 过渡动画——聚焦时边框变色更自然 */
      transition: border-color 0.2s;
    }

    .input-container input:focus {
      border-color: #3498db;
    }

    /* 发送按钮 */
    .input-container button {
      background: #3498db;
      color: white;
      border: none;
      padding: 10px 24px;
      border-radius: 20px;
      cursor: pointer;
      font-size: 15px;
      transition: background 0.2s;
    }

    .input-container button:hover {
      background: #2980b9;
    }

    .input-container button:disabled {
      background: #bdc3c7;
      cursor: not-allowed;
      /* 禁用状态视觉反馈——用户知道请求在处理中 */
    }

    /* 加载动画 */
    .loading {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 2px solid #f3f3f3;
      border-top: 2px solid #3498db;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-left: 8px;
      vertical-align: middle;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    /* 状态栏 */
    .status {
      text-align: center;
      padding: 8px;
      font-size: 12px;
      color: #aaa;
      background: white;
      border-top: 1px solid #e0e0e0;
    }
  </style>
</head>
<body>
  <div class="header">📚 个人知识库问答系统</div>
  <div class="chat-container" id="chatContainer">
    <!-- 欢迎消息 -->
    <div class="message assistant">
      <div class="message-content">你好！我是你的知识库助手。
请先在 documents 目录放入文档并运行 :import 导入，然后就可以开始提问了。

你可以问：
  - 文档中提到了哪些关键概念？
  - 关于某主题，文档里是怎么说的？
  - 帮我总结一下某文档的核心内容</div>
    </div>
  </div>
  <div class="input-container">
    <input
      type="text"
      id="questionInput"
      placeholder="输入你的问题..."
      onkeypress="if(event.key==='Enter') askQuestion()"
    />
    <button id="askButton" onclick="askQuestion()">发送</button>
  </div>
  <div class="status" id="statusBar">正在连接服务...</div>

  <script>
    //  =================================================================
    //  前端交互逻辑
    //  职责：管理聊天界面、发送请求、展示结果
    //  为什么不用 React/Vue：学习型项目，原生 JS 够用且无学习负担
    //  =================================================================

    /**
     * 添加一条消息到聊天区域
     * 为什么封装成函数：用户消息和助手消息都需要这个逻辑，复用避免重复
     *
     * @param {string} content - 消息文本内容
     * @param {'user'|'assistant'} role - 消息角色
     * @param {Array} sources - 来源引用（仅助手消息）
     */
    function addMessage(content, role, sources = []) {
      const container = document.getElementById("chatContainer");

      // 创建消息容器 div
      const messageDiv = document.createElement("div");
      messageDiv.className = `message ${role}`;

      // 创建消息内容 div
      const contentDiv = document.createElement("div");
      contentDiv.className = "message-content";
      // textContent 比 innerHTML 更安全——防止 XSS（跨站脚本攻击）
      contentDiv.textContent = content;
      messageDiv.appendChild(contentDiv);

      // 如果是助手消息且有来源，展示来源标签
      if (role === "assistant" && sources.length > 0) {
        const sourcesDiv = document.createElement("div");
        sourcesDiv.className = "sources";

        // 为每个来源创建小标签
        sources.forEach((s) => {
          const tag = document.createElement("span");
          tag.className = "source-item";
          // 格式：文件名[页码] 相似度
          tag.textContent = `${s.source}${s.page ? " p." + s.page : ""}`;
          // title 属性——鼠标悬停时显示完整信息
          tag.title = `相似度: ${s.score.toFixed(2)}\n${s.snippet}`;
          sourcesDiv.appendChild(tag);
        });

        messageDiv.appendChild(sourcesDiv);
      }

      container.appendChild(messageDiv);

      // 自动滚动到底部——确保用户总能看到最新消息
      // 为什么用 scrollTop：简单直接，不需要引入复杂的滚动库
      container.scrollTop = container.scrollHeight;
    }

    /**
     * 添加加载指示器（旋转动画）
     * 为什么需要加载指示器：API 调用可能需要几秒钟，用户需要知道系统在工作
     * @returns 加载消息的 DOM 元素，用于回答完成后移除
     */
    function addLoading() {
      const container = document.getElementById("chatContainer");
      const loadingDiv = document.createElement("div");
      loadingDiv.className = "message assistant";
      loadingDiv.id = "loadingMessage";

      const contentDiv = document.createElement("div");
      contentDiv.className = "message-content";
      contentDiv.innerHTML =
        '正在思考中...<span class="loading"></span>';
      loadingDiv.appendChild(contentDiv);

      container.appendChild(loadingDiv);
      container.scrollTop = container.scrollHeight;

      return loadingDiv;
    }

    /**
     * 提问——核心交互函数
     * 为什么定义为 async：需要等待 API 响应
     */
    async function askQuestion() {
      const input = document.getElementById("questionInput");
      const button = document.getElementById("askButton");
      const question = input.value.trim();

      // 空问题不做处理
      if (!question) return;

      // UI 状态管理：禁用输入防止重复提交
      // 为什么禁用：避免用户在等待回答时发送第二个问题，导致状态混乱
      input.disabled = true;
      button.disabled = true;
      // 切换按钮文字——给用户明确的"处理中"反馈
      button.textContent = "发送中...";

      // 在聊天区显示用户的问题
      addMessage(question, "user");
      // 清空输入框——准备好接收下一个问题
      input.value = "";

      // 显示加载动画
      const loadingEl = addLoading();

      // 更新状态栏
      const statusBar = document.getElementById("statusBar");
      statusBar.textContent = "正在检索并生成回答...";

      try {
        // 调用后端 API
        // 为什么用 fetch 而不是 axios：fetch 是浏览器内置的，不需要额外依赖
        const response = await fetch("/api/ask", {
          method: "POST",
          headers: {
            // Content-Type 告诉服务器请求体格式
            "Content-Type": "application/json",
          },
          // 将 JavaScript 对象转为 JSON 字符串
          body: JSON.stringify({ query: question }),
        });

        // 检查 HTTP 状态码
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "请求失败");
        }

        const data = await response.json();

        // 移除加载动画
        loadingEl.remove();

        // 显示回答和来源
        addMessage(data.answer, "assistant", data.sources);
        statusBar.textContent = `已就绪 | 参考了 ${data.sources.length} 个来源`;
      } catch (error) {
        // 错误处理：移除加载动画，显示错误信息
        loadingEl.remove();
        addMessage(`❌ 出错：${error.message}`, "assistant");
        statusBar.textContent = "请求失败，请重试";
      } finally {
        // 恢复 UI 状态（无论成功还是失败都要执行）
        // 为什么用 finally：确保输入框和按钮一定被恢复
        input.disabled = false;
        button.disabled = false;
        button.textContent = "发送";
        input.focus(); // 自动聚焦输入框，方便连续提问
      }
    }

    /**
     * 页面加载时检查服务状态
     * 为什么在加载时检查：如果服务没启动，用户应该第一时间知道
     */
    (async function checkHealth() {
      const statusBar = document.getElementById("statusBar");
      try {
        const response = await fetch("/api/health");
        const data = await response.json();
        statusBar.textContent = data.message;
      } catch {
        statusBar.textContent =
          "⚠️ 无法连接到服务，请检查服务是否启动";
      }
    })();
  </script>
</body>
</html>
```

### 9.5 启动 Web 服务

在 `package.json` 中添加：

```json
{
  "scripts": {
    "start": "tsx src/index.ts",
    "server": "tsx src/server.ts",
    "build": "tsc",
    "start:prod": "tsc && node dist/index.js"
  }
}
```

运行：

```bash
npm run server
```

然后打开浏览器访问 `http://localhost:3000`。

---

## 完整代码清单

### 最终项目结构

```
knowledge-base/
├── .env                          # API 密钥（不提交到 Git）
├── .gitignore                    # Git 忽略规则
├── package.json                  # 项目依赖和脚本
├── tsconfig.json                 # TypeScript 编译配置
├── data/                         # 测试文档
│   └── 测试文档-机器学习.md       # 示例测试文档
├── documents/                    # 用户上传的文档（运行时目录）
│   ├── .gitkeep                  # 保持空目录在 Git 中
├── chroma_db/                    # ChromaDB 数据（运行时目录，Git忽略）
├── public/                       # Web 前端静态文件
│   └── index.html                # 聊天界面
└── src/
    ├── index.ts                  # CLI 主入口
    ├── server.ts                 # Web 服务入口（可选）
    ├── types.ts                  # 全局类型定义
    ├── loader.ts                 # 文档加载器
    ├── chunker.ts                # 文本分块器
    ├── embedder.ts               # 向量化模块
    ├── store.ts                  # ChromaDB 存储模块
    ├── retriever.ts              # 检索器
    └── qa-engine.ts              # 问答引擎
```

### 快速启动脚本

```bash
# 1. 克隆/进入项目
cd knowledge-base

# 2. 安装依赖
npm install

# 3. 配置 API Key
# 编辑 .env 文件，填入你的 OPENAI_API_KEY

# 4. 启动 ChromaDB（另一个终端窗口）
chroma run --path ./chroma_db

# 5. 放入文档到 documents/ 目录

# 6. 启动 CLI
npm start

# 7. 在 CLI 中输入 :import 导入文档

# 8. 开始提问！:ask 什么是机器学习？

# 或者启动 Web 服务
npm run server
# 打开 http://localhost:3000
```

---

## 常见问题排查

### 问题 1：检索到的内容和我的问题完全不相关

**现象**：问"机器学习"，返回的内容是关于"项目排期"的。

**可能原因和解决**：

| 原因 | 如何判断 | 如何解决 |
|------|---------|---------|
| 分块太大（chunkSize） | 块内容包含多个不相关的主题 | 减小 chunkSize（如 800 → 400） |
| 文档编码问题 | 查看存储的内容是否是乱码 | 检查 loader 中的编码处理逻辑 |
| embedding 质量问题 | 相似度分数普遍很低 | 检查是否用了正确的 embedding 模型 |
| 知识库混入了无关文档 | 检索到的文件名和预期不同 | 清空知识库后只导入目标文档 |

### 问题 2：LLM 编造了文档中没有的内容（幻觉）

**现象**：答案中出现了文档里不存在的信息，但看起来"合情合理"。

**解决策略**：
1. **强化提示词约束**——在提示词中增加更强烈的否定指令：
   ```
   你绝对不能编造任何信息。如果你不确定，必须承认不确定。
   ```
2. **降低 temperature**——从 0.3 降到 0.1 甚至 0，减少模型"创造性发挥"的空间
3. **要求逐句引用**——修改提示词，要求模型的每一句话后面都要标注引用来源
4. **使用更强的模型**——gpt-4o-mini 比 gpt-3.5-turbo 幻觉少很多

### 问题 3：文档中的表格检索不到

**现象**：文档中有清晰的表格数据，但提问时检索不到相关内容。

**原因**：嵌入模型对"纯文本"效果很好，但对表格式的"结构化数据"效果差。

**解决**：
1. **预处理表格**——在分块之前，将表格转为描述性文本：
   ```
   原始表格：
   | 姓名 | 年龄 | 部门   |
   |------|------|--------|
   | 张三 | 30   | 技术部 |
   | 李四 | 25   | 市场部 |

   转换后：
   张三，30岁，在技术部工作。李四，25岁，在市场部工作。
   ```
2. **使用表格专用的分块策略**——用正则检测表格（连续的 `|` 符号），不切割表格行

### 问题 4：回答速度太慢

**现象**：从提问到看到回答需要 5 秒以上。

**优化方向**：

1. **减少检索块数**：`maxResults` 从 5 降到 3，topic 简单的话 3 个块足够
2. **缩短块大小**：`chunkSize` 减小 → 每个块更短 → 上下文更精炼 → LLM 推理更快
3. **换更快模型**：`gpt-4o-mini` 比 `gpt-4o` 快 3-5 倍
4. **降低 embedding 维度**：从 1536 降到 512，检索速度不受影响，存储更小
5. **添加回答缓存**：对完全相同的问题缓存答案，避免重复调用 LLM

### 问题 5：ChromaDB 连接失败

**现象**：启动程序时报错"无法连接到 ChromaDB"。

**确认步骤**：
1. 检查 ChromaDB 是否在运行：`pip list | grep chromadb`
2. 手动启动 ChromaDB 服务：`chroma run --path ./chroma_db`
3. 检查端口是否被占用：默认端口是 8000

---

## 下一步学习

这个项目为你打开了 RAG 的大门。如果想继续深入，以下是推荐的学习路径：

### 进阶方向

| 方向 | 学习内容 | 难度 | 价值 |
|------|---------|------|------|
| **Agent 化** | 让系统自动判断是否需要检索、检索几次、是否需要联网搜索 | 高 | 极高 |
| **多模态 RAG** | 支持图片、音频、视频的检索和问答 | 高 | 高 |
| **增量更新** | 不重建整个知识库，只更新变更的文档 | 中 | 高 |
| **混合检索** | 结合关键词检索（BM25）+ 向量检索，提高召回率 | 中 | 中 |
| **多用户支持** | 每个用户独立的文档和权限 | 中 | 中 |
| **生产部署** | Docker 化、监控、日志、CI/CD | 中 | 高 |
| **本地模型** | 使用 Ollama 本地运行 embedding 和 LLM，完全离线 | 中 | 高 |

### 相关学习资源

本项目涉及到的核心概念在之前的教程中有更深入的讲解：

| 概念 | 参考文件 | 相关章节 |
|------|---------|---------|
| RAG 架构原理 | `06-检索增强生成-RAG.md` | RAG 工作流程、索引策略 |
| 提示词工程 | `03-提示词工程-Prompt-Engineering.md` | 角色定义、Grounding 技术 |
| Agent 概念 | `01-AI智能体-AI-Agent.md` | Agent 思维、工具调用 |
| 幻觉问题 | `05-AI幻觉-Hallucination.md` | 幻觉成因、缓解策略 |
| 向量与 Embedding | `09-Token化-Tokenization.md` | Embedding 原理介绍 |
| 模型选择 | `10-模型选型-Model-Selection.md` | LLM 和 Embedding 模型对比 |
| 部署与成本 | `14-部署与成本-Deployment-Cost.md` | API 费用估算、部署方案 |

---

## 结束语

恭喜你完成了这个实战项目。如果这是你第一次构建 RAG 系统，你应该感到自豪——你已经掌握了目前业界最主流的 AI 应用架构。

回顾一下你构建的系统：

```
用户上传文档 → 文本提取 → 分块 → 向量化 → 存入向量库
用户提问     → 向量化   → 检索相似块 → 拼入提示词 → LLM回答
```

这个看似简单的流水线，背后包含了：

- 文档解析（处理了 PDF、Markdown、TXT 三种格式）
- 文本分块（理解了 chunkSize 和 chunkOverlap 对检索质量的影响）
- 向量化（使用 OpenAI 的 embedding 模型将文本转为数字）
- 相似度检索（在 ChromaDB 中查找相关内容）
- 提示词工程（构建了防幻觉、带来源引用的高质量提示词）
- 实验迭代（用测试数据驱动参数调优）

每一个环节都有大量的优化空间。随着你使用这个系统的频率增加，你会逐渐发现哪些地方可以改进——这恰恰是一个优秀 AI 工程师的成长路径：**在实战中发现问题，在实验中验证假设，在迭代中提升质量。**

祝你使用愉快，持续学习！
