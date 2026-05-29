# AI Skills（技能系统）

## 1. 什么是 AI Skills 系统

AI Skills 是将 AI 能力**模块化、可组合化**的一种设计模式。每个 Skill 是一个独立的"能力包"，包含特定领域的知识、工具和提示词模板。通过组合不同的 Skill，可以快速构建复杂的 AI 应用。

**核心理念**: 像搭积木一样组装 AI 能力，而不是每次都从零开始。

## 2. Skills 的组成要素

一个完整的 Skill 通常包含以下部分：

```typescript
/** Skill 基类 */
interface Skill {
    name: string;           // 技能名称，如 "code-review"
    description: string;    // 技能描述，告诉 AI 何时使用
    triggers: string[];     // 触发条件，如关键词 ["审查", "review", "检查代码"]
    prompt: string;         // 系统提示词 / 行为指令
    tools: string[];        // 该 Skill 可用的工具
    knowledge: string[];    // 领域知识（RAG 文档、规则库等）
    examples: string[];     // Few-shot 示例
    constraints: string[];  // 行为约束
}
```

### 2.1 示例：Code Review Skill

```typescript
const codeReviewSkill: Skill = {
    name: "code-review",
    description: "审查代码质量，检查Bug、安全漏洞和性能问题",
    triggers: ["审查代码", "review", "检查这段代码", "code review"],
    prompt: `你是一位资深代码审查专家。
审查原则：
1. 优先检查安全漏洞（SQL注入、XSS、敏感信息泄露）
2. 检查逻辑错误和边界条件
3. 评估性能（N+1查询、不必要的循环）
4. 代码可读性（命名、注释、结构）
5. 给出具体修改建议和修改后的代码
对于每个问题，标注严重程度：🔴严重 / 🟡一般 / 🟢建议`,
    tools: [],
    knowledge: ["OWASP Top 10", "SOLID原则", "Clean Code"],
    examples: [],
    constraints: [],
};
```

### 2.2 示例：Translation Skill

```typescript
const translationSkill: Skill = {
    name: "translator",
    description: "专业翻译，支持中英互译",
    triggers: ["翻译", "translate", "中译英", "英译中"],
    prompt: `你是一位专业翻译。要求：
1. 准确传达原文意思，不添加不删减
2. 符合目标语言的表达习惯
3. 专业术语保持准确
4. 输出格式：先展示翻译结果，再附上关键术语对照表`,
    tools: [],
    knowledge: [],
    examples: [],
    constraints: [],
};
```

## 3. Skills 系统架构

### 3.1 路由式架构（Router-based）

```
用户输入 → Skill Router → 匹配 Skill → 注入对应 Prompt → LLM 生成
                ↓
         Skill Registry
        ┌──────────────┐
        │ code-review  │
        │ translator   │
        │ data-analysis│
        │ ...          │
        └──────────────┘
```

```typescript
/** 根据用户意图路由到对应 Skill */
class SkillRouter {
    private skills: Map<string, Skill>;  // 注册的 Skill

    constructor() {
        this.skills = new Map();
    }

    /** 注册 Skill */
    register(skill: Skill): void {
        this.skills.set(skill.name, skill);
    }

    /** 匹配用户意图，返回相关 Skill */
    match(userInput: string): Skill[] {
        const matched: Skill[] = [];
        for (const skill of this.skills.values()) {
            // 使用关键词匹配或 LLM 语义匹配
            if (skill.triggers.some(trigger => userInput.includes(trigger))) {
                matched.push(skill);
            }
        }
        return matched;
    }

    /** 根据用户输入构建系统提示词 */
    getSystemPrompt(userInput: string): string {
        const matchedSkills = this.match(userInput);
        const prompts = matchedSkills.map(skill => skill.prompt);
        return prompts.length > 0 ? prompts.join("\n\n") : "你是一个通用AI助手";
    }
}
```

### 3.2 组合式架构（Composition-based）

多个 Skill 可以组合成一个"工作流"：

```typescript
/** 将多个 Skill 串联成工作流 */
class SkillPipeline {
    private skills: Skill[];

    constructor(skills: Skill[]) {
        this.skills = skills;
    }

    /** 按顺序执行 Skill */
    async execute(inputData: string): Promise<string> {
        let result = inputData;
        for (const skill of this.skills) {
            result = await skill.run(result);  // 上一个 Skill 的输出作为下一个的输入
        }
        return result;
    }
}

// 示例：数据分析工作流
const pipeline = new SkillPipeline([
    dataCollectionSkill,    // 1. 收集数据
    dataCleaningSkill,      // 2. 清洗数据
    dataAnalysisSkill,      // 3. 分析数据
    reportGenerationSkill,  // 4. 生成报告
]);
```

### 3.3 Agent + Skills 架构

```typescript
/** 具备多种 Skill 的 Agent，能自主选择和使用 Skill */
class SkillAgent {
    private skills: Map<string, Skill>;
    private activeSkills: Skill[];

    constructor(skills: Map<string, Skill>) {
        this.skills = skills;
        this.activeSkills = [];
    }

    /** LLM 自主决定使用哪个 Skill */
    decideSkill(task: string): Skill {
        const skillDescriptions = Array.from(this.skills.entries())
            .map(([name, skill]) => `- ${name}: ${skill.description}`)
            .join("\n");

        const prompt = `你有以下技能：
${skillDescriptions}

任务：${task}
请选择最适合的技能来处理这个任务。只回复技能名称。`;
        const skillName = llm(prompt).trim();
        return this.skills.get(skillName)!;
    }
}
```

## 4. Claude Code Skills 系统剖析

Claude Code 的 Skills 系统是最成熟的 AI Skills 实现之一：

### 4.1 Skill 文件结构

```bash
~/.claude/skills/
├── commit.md          # Git 提交流程
├── review-pr.md       # PR 审查
├── simplify.md        # 代码简化重构
├── schedule.md        # 定时任务
└── update-config.md   # 配置更新
```

### 4.2 Skill 文件格式

```markdown
---
name: commit
description: 规范的 Git 提交流程
triggers:
  - 提交代码
  - commit
  - 创建提交
---

# Commit Skill

## 触发条件
当用户说"提交代码"、"commit"、"创建提交"时触发。

## 工作流程
1. 运行 `git status` 查看所有变更
2. 运行 `git diff` 查看具体改动
3. 运行 `git log` 了解提交历史风格
4. 分析变更，生成符合规范的 commit message
5. 执行 `git add` + `git commit`
6. 运行 `git status` 确认提交成功

## 约束
- 不提交 .env / 密钥文件
- 不 amend 已有提交（除非用户明确要求）
- commit message 用中文
- 只说明"为什么"，不说明"改了什么"
```

### 4.3 Skills 的执行流程

```
1. 用户发送消息 → 2. 系统检查 Skills 触发条件
       ↓
3. 匹配到 Skill → 4. 注入 Skill Prompt 到系统指令
       ↓
5. LLM 按 Skill 指令执行 → 6. 返回结果给用户
```

## 5. 设计一个好的 Skill 的原则

### 5.1 单一职责
一个 Skill 只做一件事，做好这件事。不要在一个 Skill 里塞太多不相关的功能。

### 5.2 描述即文档
Skill 的 description 字段是给 AI 看的，要写得清楚明确，让 AI 知道"什么时候用"和"怎么用"。

```yaml
# 好的 description
description: "当用户要求提交代码时使用此技能。包含检查变更、生成规范commit message、执行提交的全流程。"

# 不好的 description  
description: "代码相关操作"  # 太模糊，AI 不知道什么时候用
```

### 5.3 约束明确
告诉 AI **不能做什么**和必须**做什么同样重要**：
- "不提交 .env 文件"
- "不修改用户没提到的代码"
- "必须先读文件再编辑"

### 5.4 有清晰的输入输出
```typescript
const skill = {
    inputSchema: {  // 明确输入
        code: "要审查的代码",
        language: "编程语言",
        focus: ["security", "performance"]  // 可选
    },
    outputSchema: {  // 明确输出
        issues: [
            { line: 42, severity: "high", description: "..." }
        ],
        suggestions: "改进建议"
    }
};
```

## 6. 推荐文章与资源

### 必读文章
- [Anthropic: Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) — Skills 设计的核心思想来源
- [Claude Code Skills 文档](https://docs.anthropic.com/en/docs/claude-code/skills)
- [The Rise of the AI Plugin Ecosystem](https://a16z.com/ai-plugins/) — 商业视角

### GitHub 仓库
- [Claude Code Skills](https://github.com/anthropics/claude-code) — 参考官方 Skills 写法
- [awesome-chatgpt-plugins](https://github.com/underlines/awesome-chatgpt-plugins) — 插件合集
- [LangChain Tools](https://github.com/langchain-ai/langchain/tree/master/libs/langchain/langchain/tools) — 工具/Skill 定义参考
- [Semantic Kernel Plugins](https://github.com/microsoft/semantic-kernel) — 微软的 Skill/Plugin 系统

### 实践参考
- [OpenAI GPTs](https://chat.openai.com/gpts) — 用户自定义 GPT（每个就是一个 Skill）
- [Coze Bots](https://www.coze.com/) — 字节跳动的 Bot 平台
- [Dify Tools](https://docs.dify.ai/) — Dify 的工具/Skills 系统
