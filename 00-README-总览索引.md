# AI 系统学习路线图（完整版）

> **代码示例说明**：本系列所有文档中的代码示例均使用 **TypeScript/Node.js** 编写，兼顾前后端开发者的阅读体验。大部分示例可在浏览器端或 Node.js 环境中直接运行，无需额外安装 Python 环境。

## 学习顺序建议（5 阶段 + 实战）

> **如果你是 AI 零基础**：从 `00-getting-started` 开始，先跑通第一个 API 调用，再做实战项目。
> **如果你已经会调 API**：直接跳到 `16-capstone-project` 做项目，遇到不懂的再回来查。

```
第0阶段：环境与概念（AI零基础从这里开始）
├── 00-getting-started ← 搭建环境、第一个API调用、理解核心概念
└── 17-ai-mindset ← 理解"AI编程"和"传统编程"的本质区别

第1阶段：基础入门
├── 提示词工程 (Prompt Engineering)
├── Tokenization（理解 token 怎么算的）
└── AI 幻觉理解与处理

第2阶段：核心能力
├── RAG (检索增强生成) ← 最重要的技术
├── Function Calling / Tool Use
├── Embedding 与向量数据库
└── 多模态 AI (Vision / Audio)

第3阶段：进阶架构
├── AI Agent (智能体)
├── MCP (Model Context Protocol)
├── Skills 技能系统
└── 上下文窗口管理 ← 解决实际痛点

第4阶段：工程落地
├── 模型选型（选对模型省 70% 成本）
├── 推理优化（量化 / vLLM / Flash Attention）
├── 缓存策略与流式输出
├── 部署方案与成本优化
├── 数据工程（RAG 数据准备 + 微调数据）
└── AI 应用架构设计

第5阶段：持续优化
├── 评估体系与监控 ← 25-评估流水线与CI
├── 安全与合规 ← 28-安全护栏与可观测性
└── 可观测性 (Observability) ← 28-安全护栏与可观测性

实战项目：
├── 16-实战项目 ← 从零构建个人知识库问答系统
└── 18-高级技巧 ← Scratchpad/长上下文路由/记忆压缩

进阶专题：
├── 19-GraphRAG-DSPy ← 知识图谱RAG + 自动化Prompt优化
├── 20-工程实践 ← AI测试方法/浏览器端AI/产品UX设计
├── 21-理论基础 ← Transformer/训练流程/推理模型/Embedding原理
├── 25-评估流水线与CI ← 评估数据集/A/B对比/CI质量门禁/趋势追踪
├── 28-安全护栏与可观测性 ← Guardrails/Trace/兼容DeepSeek的完整案例
└── 29-Agent工作流编排与人工审批 ← Workflow / HITL / 状态机完整案例

完整实战项目：
└── 22-Agent工具调用 ← 完整的Agent工具调用端到端实战（能跑）
```

## 完整文档索引

| # | 文档 | 核心内容 | 适合谁 |
|---|------|----------|--------|
| **入门** | | | |
| — | [00-入门指南](./00-入门指南-Getting-Started.md) | 环境搭建、第一个API调用、核心概念 | **AI零基础必读** |
| — | [17-AI开发思维](./17-AI开发思维-AI-Engineering-Mindset.md) | AI编程vs传统编程、调试方法、迭代思路 | **AI零基础必读** |
| **基础** | | | |
| 01 | [AI Agent](./01-AI智能体-AI-Agent.md) | ReAct、多 Agent 协作、框架对比、安全设计 | |
| 02 | [MCP](./02-MCP协议-Model-Context-Protocol.md) | 协议详解、TypeScript SDK、Claude Desktop 配置 | |
| 03 | [提示词工程](./03-提示词工程-Prompt-Engineering.md) | CoT/ToT/ReAct、模板化、Prompt Injection 防护 | |
| 04 | [Skills](./04-技能系统-Skills.md) | Skill 组成、路由/组合架构、Claude Code 剖析 | |
| 05 | [AI 幻觉](./05-AI幻觉-Hallucination.md) | 成因分类、检测方法、CoVe/Grounding 缓解 | |
| **核心** | | | |
| 06 | [RAG](./06-检索增强生成-RAG.md) | Chunking/Embedding/检索/重排/评估全流程 | |
| 07 | [进阶知识](./07-进阶知识-Advanced-Topics.md) | Fine-tuning、Embedding、安全、可观测性 | |
| 08 | [上下文管理](./08-上下文管理-Context-Management.md) | 分层记忆、摘要递归、选择性注入、长模型兜底 | |
| 09 | [Tokenization](./09-Token化-Tokenization.md) | Token 计算、多语言对比、成本优化技巧 | |
| **工程** | | | |
| 10 | [模型选型](./10-模型选型-Model-Selection.md) | 全球模型对比、按场景选型、成本计算、兜底策略 | |
| 11 | [推理优化](./11-推理优化-Inference-Optimization.md) | 量化/Flash Attention/vLLM/投机解码 | |
| 12 | [缓存与流式](./12-缓存与流式-Caching-Streaming.md) | 语义缓存/Prompt Cache/SSE 流式/常见坑 | |
| 13 | [多模态 AI](./13-多模态AI-Multimodal.md) | Vision/TTS/STT/视频生成/多模态 RAG | |
| 14 | [部署与成本](./14-部署与成本-Deployment-Cost.md) | 部署方案/LiteLLM 网关/10 条成本优化策略 | |
| 15 | [数据与架构](./15-数据与架构-Data-Architecture.md) | 数据工程全流程/AI 应用架构 5 种模式 | |
| **实战** | | | |
| — | [16-实战项目](./16-实战项目-Capstone-Project.md) | 从零构建个人知识库问答系统 | **动手必做** |
| — | [18-高级技巧](./18-高级实战技巧-Advanced-Techniques.md) | Scratchpad/长上下文路由/记忆压缩 | **进阶必读** |
| — | [19-进阶专题1](./19-进阶专题1-GraphRAG-DSPy.md) | Graph RAG / 知识图谱 + DSPy自动化Prompt | **选读** |
| — | [20-进阶专题2](./20-进阶专题2-Engineering-Practice.md) | AI应用测试 / 浏览器端AI / 产品UX设计 | **选读** |
| **理论** | | | |
| — | [21-理论基础](./21-理论基础-Theoretical-Foundations.md) | Transformer/训练全流程/推理模型/Embedding | **进阶必读** |
| **实战** | | | |
| — | [22-Agent工具调用](./22-Agent工具调用实战-Agent-Tool-Use.md) | 完整Agent工具调用：天气/搜索/计算/时间，可运行 | **动手必做** |
| — | [25-评估流水线与CI](./25-评估流水线与CI-Eval-Pipeline.md) | 评估数据集设计/A/B对比/CI质量门禁/GitHub Actions流水线 | **工程必读** |
| — | [28-AI安全护栏与可观测性](./28-AI安全护栏与可观测性-Guardrails-Observability.md) | Guardrails、Zod输出校验、Trace日志、DeepSeek兼容调用完整案例 | **工程必读** |
| — | [29-Agent工作流编排与人工审批](./29-Agent工作流编排与人工审批-HITL-Workflow.md) | Workflow、人工审批、状态机、审计日志完整案例 | **工程必读** |

## 按问题查找

| 你想解决的问题 | 去看哪个文档 |
|----------------|-------------|
| **我是AI零基础，想入门** | 00-入门指南 → 16-实战项目 → 17-AI开发思维 |
| 模型总是胡说八道 | 05-幻觉 + 06-RAG |
| 上下文太长/对话久了模型失忆 | 08-上下文管理 |
| API 费用太高 | 10-模型选型 + 14-部署与成本 + 12-缓存 |
| 想自己部署模型 | 11-推理优化 + 14-部署与成本 |
| 做知识库问答机器人 | 06-RAG + 15-数据与架构 + 16-实战项目 |
| 做能自动执行任务的 AI | 01-Agent + 04-Skills + 02-MCP |
| 不知道怎么选模型 | 10-模型选型 |
| 想做多模态（图/音/视频） | 13-多模态 |
| Prompt 写不好 | 03-提示词工程 |
| 想做 AI 应用不知道怎么设计架构 | 15-数据与架构 + 17-AI开发思维 |
| 模型太慢 | 11-推理优化 + 12-缓存与流式 |
| 担心数据安全 | 07-进阶(AI安全) + 14-部署(私有化) |
| 想给AI应用加护栏和调用日志 | 28-安全护栏与可观测性 |
| 想做需要人工审批的AI流程 | 29-Agent工作流编排与人工审批 |
| 中文效果不好 | 10-模型选型 + 09-Tokenization |
| 用户反馈 AI 质量不稳定 | 07-进阶(评估体系) + 05-幻觉 + 17-AI开发思维 |
| **不知道怎么写评估/调试AI** | 17-AI开发思维 |
| **想做项目练手** | 16-实战项目 |
| **对话太长，成本太高** | 08-上下文 + 18-高级技巧(记忆压缩) |
| **不知道怎么给Agent做工作记忆** | 18-高级技巧(Scratchpad) |
| **长文档和短问题怎么区别对待** | 18-高级技巧(长上下文路由) |
| **RAG检索不到关联信息（如人物关系）** | 19-GraphRAG |
| **Prompt优化太费时间，想自动化** | 19-DSPy |
| **怎么测试AI应用的质量** | 20-工程实践(AI测试) |
| **怎么做AI评估、A/B对比、CI质量门禁** | 25-评估流水线与CI |
| **怎么在GitHub Actions里自动化AI质量检查** | 25-评估流水线与CI |
| **想在浏览器里跑AI模型** | 20-工程实践(浏览器端AI) |
| **AI产品的交互体验怎么设计** | 20-工程实践(UX设计) |

## 技术栈参考

本系列涵盖 Python 与 Node.js/TypeScript 双生态的主流工具链：

| 领域 | Python 生态（热门选择） | Node.js/TypeScript 生态（热门选择） |
|------|-------------------------|-------------------------------------|
| LLM 应用框架 | LangChain、LlamaIndex | LangChain.js、LlamaIndex.TS、Vercel AI SDK |
| Agent 编排 | LangGraph、CrewAI | LangGraph.js、Vercel AI SDK、Mastra |
| 推理引擎 | vLLM、HuggingFace TGI | Ollama（通用）、llama.cpp 绑定 |
| MCP SDK | `mcp` (Python SDK) | 稳定线：`@modelcontextprotocol/sdk`；2.0 alpha：`@modelcontextprotocol/server` / `@modelcontextprotocol/client` |
| 向量数据库 | ChromaDB、Milvus | ChromaDB、Pinecone（均有 JS 客户端） |
| 可观测性 | LangFuse、Phoenix | LangFuse、LangSmith（均有 JS SDK） |
| 模型客户端 | `openai`、`anthropic` | `openai`、`@anthropic-ai/sdk` |
| 微调框架 | LLaMA-Factory、HuggingFace | 不常用于 Node.js，建议复用 Python 方案 |
| API 网关 | LiteLLM（Python） | 自建网关或调用 LiteLLM 服务 |

## 必读文章速览

### 综合必读
- [Anthropic: Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Lilian Weng: LLM Powered Autonomous Agents](https://lilianweng.github.io/posts/2023-06-23-agent/)
- [Chip Huyen: Building LLM Applications](https://huyenchip.com/2024/02/28/genai-apps.html)
- [Eugene Yan: Patterns for Building LLM Systems](https://eugeneyan.com/writing/llm-patterns/)

### 专项必读
- [Prompt Engineering Guide (中文)](https://www.promptingguide.ai/zh)
- [RAG 论文综述](https://arxiv.org/abs/2312.10997)
- [MCP 官方文档](https://modelcontextprotocol.io/docs)
- [OWASP Top 10 for LLM](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
- [Lost in the Middle (长上下文注意力)](https://arxiv.org/abs/2307.03172)

### 必关注 GitHub 仓库
- [LangChain](https://github.com/langchain-ai/langchain) — LLM 应用开发框架（Python + JS 双语言）
- [Vercel AI SDK](https://github.com/vercel/ai) — TypeScript 生态首选 AI SDK
- [vLLM](https://github.com/vllm-project/vllm) — 高性能推理引擎
- [LiteLLM](https://github.com/BerriAI/litellm) — 多模型 API 网关
- [Dify](https://github.com/langgenius/dify) — 低代码 AI 应用平台
- [LangGraph](https://github.com/langchain-ai/langgraph) — Agent 编排（Python + JS 双语言）
- [MCP Servers](https://github.com/modelcontextprotocol/servers) — MCP Server 参考实现
- [LLaMA-Factory](https://github.com/hiyouga/LLaMA-Factory) — 最易用的微调框架（Python）
- [Ollama](https://github.com/ollama/ollama) — 本地模型一行命令
- [RAGAS](https://github.com/explodinggradients/ragas) — RAG 评估
- [LangFuse](https://github.com/langfuse/langfuse) — LLM 可观测性（Python + JS SDK）
- [FastGPT](https://github.com/labring/FastGPT) — 中文知识库问答
- [GraphRAG (Microsoft)](https://github.com/microsoft/graphrag) — 图谱增强 RAG
