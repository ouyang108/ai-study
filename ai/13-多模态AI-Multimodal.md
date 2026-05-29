# 多模态 AI（Multimodal AI）

## 1. 什么是多模态

多模态 AI 能同时理解和生成**文本、图片、音频、视频**等多种类型的数据。2025-2026 年是多模态能力爆发的两年。

```
传统 LLM:      文本入 → 文本出
多模态 LLM:    文本+图片+音频+视频入 → 文本+图片+音频出
```

## 2. 能力矩阵

| 能力 | 代表模型 | 说明 |
|------|----------|------|
| 图片理解 | GPT-4o, Claude, Gemini, Qwen-VL | 看图回答问题、OCR、图表分析 |
| 图片生成 | DALL-E 3, Stable Diffusion, Midjourney, Flux | 文生图 |
| 音频理解 | Gemini, GPT-4o, Whisper | 语音转文字、音频分析 |
| 音频生成 | GPT-4o, ElevenLabs, Fish Audio | TTS 文字转语音 |
| 视频理解 | Gemini 2.5 Pro | 看视频回答问题（目前只有 Gemini） |
| 视频生成 | Sora, Runway, Kling | 文生视频/图生视频 |
| 跨模态检索 | CLIP, ImageBind | 文本搜图、图搜图 |

## 3. 图片理解（Vision）

### 3.1 主流 Vision API 调用

```typescript
// === OpenAI GPT-4o Vision ===
import OpenAI from "openai";
import fs from "fs";

// 初始化 OpenAI 客户端
const client = new OpenAI();

// 将图片编码为 base64
function encodeImage(filePath: string): string {
  const imageBuffer = fs.readFileSync(filePath);
  return imageBuffer.toString("base64");
}

const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "这张图里有什么？请详细描述" },
      { type: "image_url", image_url: {
        url: `data:image/jpeg;base64,${encodeImage("photo.jpg")}`,
        detail: "high"  // low/auto/high
      }}
    ]
  }],
  max_tokens: 500,
});

// === Claude Vision ===
import Anthropic from "@anthropic-ai/sdk";

// 初始化 Anthropic 客户端
const anthropicClient = new Anthropic();

// 读取图片并编码为 base64
const imageBuffer = fs.readFileSync("photo.jpg");
const imageData = imageBuffer.toString("base64");

const response2 = await anthropicClient.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 500,
  messages: [{
    role: "user",
    content: [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: imageData,
        }
      },
      { type: "text", text: "描述这张图片" }
    ]
  }],
});
```

### 3.2 Vision 能力对比

| 能力 | GPT-4o | Claude | Gemini | Qwen-VL |
|------|--------|--------|--------|---------|
| 通用场景描述 | ★★★★★ | ★★★★★ | ★★★★☆ | ★★★★☆ |
| OCR 文字提取 | ★★★★★ | ★★★★☆ | ★★★★☆ | ★★★★★ |
| 图表/表格理解 | ★★★★☆ | ★★★★★ | ★★★★☆ | ★★★★☆ |
| 手写内容识别 | ★★★★☆ | ★★★★☆ | ★★★★☆ | ★★★★☆ |
| 多图对比 | ★★★★☆ | ★★★★☆ | ★★★★★ | ★★★☆☆ |
| PDF 解析 | ★★★★☆ | ★★★★★ | ★★★★☆ | ★★★★☆ |
| 医学影像 | ★★★☆☆ | ★★★☆☆ | ★★★★★ | ★★★☆☆ |
| UI/代码截图理解 | ★★★★★ | ★★★★★ | ★★★★☆ | ★★★★☆ |

### 3.3 Vision 场景实战

```typescript
// 场景1: 发票/单据 OCR + 结构化提取
const invoiceResponse = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{
    role: "user",
    content: [
      { type: "text", text: `请提取发票中的信息，用JSON格式返回：
{
  "发票号码": "",
  "开票日期": "",
  "购买方": "",
  "销售方": "",
  "金额合计": "",
  "税额": "",
  "项目明细": [{"名称": "", "数量": 0, "单价": 0, "金额": 0}]
}` },
      { type: "image_url", image_url: { url: imageUrl } },
    ]
  }],
  response_format: { type: "json_object" },  // 强制 JSON 输出
});
const invInfo = JSON.parse(invoiceResponse.choices[0].message.content!);

// 场景2: 代码截图 → 可运行的代码
const codeResponse = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "提取图片中的代码，保持格式，不要添加任何额外文字" },
      { type: "image_url", image_url: { url: screenshotUrl } },
    ]
  }],
});

// 场景3: UI 设计稿 → 前端代码
const uiResponse = await anthropicClient.messages.create({
  model: "claude-sonnet-4-20250514",
  messages: [{
    role: "user",
    content: [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: uiImageBase64,
        }
      },
      { type: "text", text: `把这个UI设计稿转换为React + Tailwind CSS代码。
要求：组件化、响应式、可访问性、TypeScript` },
    ]
  }],
});
```

## 4. 图片/视频生成

### 4.1 图片生成方案对比

| 工具 | 类型 | 质量 | 速度 | 成本 | 最适合 |
|------|------|------|------|------|--------|
| **DALL-E 3** | API | ★★★★★ | 快(5-15s) | $0.04-0.12/张 | 通用、创意 |
| **Midjourney** | 平台 | ★★★★★ | 中(30-60s) | $10-60/月 | 艺术、设计 |
| **Stable Diffusion** | 开源 | ★★★★☆ | 取决于显卡 | 免费(需GPU) | 本地、定制 |
| **Flux.1** | 开源 | ★★★★★ | 中 | 免费(需GPU) | 真实感照片 |
| **Ideogram** | API/平台 | ★★★★★ | 快 | $0.05-0.08/张 | 文字渲染 |
| **Kling/可灵** | API/平台 | ★★★★☆ | 中 | 按量 | 视频生成 |
| **Sora (OpenAI)** | API | ★★★★★ | 慢 | 贵 | 高质量视频 |

### 4.2 DALL-E 生成代码示例

```typescript
import OpenAI from "openai";

// 初始化 OpenAI 客户端
const client = new OpenAI();

const response = await client.images.generate({
  model: "dall-e-3",
  prompt: "一只穿着宇航服的柴犬在月球表面行走，背景是地球，电影级画质",
  size: "1024x1024",
  quality: "hd",     // standard/hd
  style: "natural",  // vivid(鲜艳)/natural(自然)
  n: 1,
});

const imageUrl = response.data[0].url;
// 图片可下载或直接展示
```

## 5. 音频处理

### 5.1 语音转文字（STT）

```typescript
// === Whisper (通过 OpenAI API 调用) ===
// 使用 OpenAI 的 Whisper API
import OpenAI from "openai";
import fs from "fs";

const client = new OpenAI();

// 调用 Whisper API 进行语音转文字
const transcript = await client.audio.transcriptions.create({
  model: "whisper-1",
  file: fs.createReadStream("audio.mp3"),
  language: "zh",
  response_format: "verbose_json",  // text/srt/vtt/verbose_json
});

console.log(transcript.text);
// "大家好，今天我们来讨论人工智能的发展趋势"

// === 实时语音: GPT-4o Realtime API ===
// 支持流式语音对话，延迟 <500ms
// 适合: 实时语音助手、电话客服
// 注意: Realtime API 按分钟计费，较贵
```

### 5.2 文字转语音（TTS）

```typescript
// === OpenAI TTS ===
import OpenAI from "openai";
import fs from "fs";

const client = new OpenAI();

const response = await client.audio.speech.create({
  model: "tts-1-hd",    // tts-1(快)/tts-1-hd(高质量)
  voice: "alloy",       // alloy/echo/fable/onyx/nova/shimmer
  input: "你好，欢迎使用我们的AI助手",
  speed: 1.0,           // 0.25-4.0
  response_format: "mp3",
});

// 将生成的音频保存到文件
const buffer = Buffer.from(await response.arrayBuffer());
fs.writeFileSync("output.mp3", buffer);

// === Fish Audio (中文TTS效果最好) ===
// https://fish.audio/ — 支持声音克隆
// 通过 HTTP API 调用
// const fishResponse = await fetch("https://api.fish.audio/v1/tts", { ... });
```

## 6. 多模态 RAG

```typescript
// 多模态 RAG: 支持用文本搜索图片，或用图片搜索内容
// 核心: 用 CLIP 等多模态 Embedding 模型

// 示例: 用自然语言搜索图片库
import { pipeline } from "@xenova/transformers";

// 加载 CLIP 模型（零样本图像分类管线，底层基于 CLIP）
const classifier = await pipeline(
  "zero-shot-image-classification",
  "Xenova/clip-vit-base-patch32"
);

// 搜索: "a cat wearing sunglasses" → 在所有图片中找最匹配的
const textQuery = "一只戴着墨镜的猫";
const images = ["cat1.jpg", "cat2.jpg", "cat3.jpg"];  // 你图库中的图片

// 逐个评估每张图片与文本的匹配度
const results = [];
for (const imgPath of images) {
  const result = await classifier(imgPath, [textQuery]);
  // result 按 score 降序排列
  results.push({ path: imgPath, score: result[0].score });
}

// 找到最匹配的图片
results.sort((a, b) => b.score - a.score);
const bestMatch = results[0];
console.log(
  `最匹配的是 ${bestMatch.path}，相似度 ${(bestMatch.score * 100).toFixed(2)}%`
);
```

## 7. 多模态的发展趋势

```
2023: 图片理解（看图回答问题）
2024: 图片生成普及（DALL-E 3 / Midjourney / SD）
2025: 视频理解（Gemini） + 实时语音（GPT-4o Realtime）
2026: 视频生成 + 全模态统一模型 + 实时视频理解
未来: 世界模型（World Model）— 理解物理世界的因果规律
```

## 8. 推荐文章

- [OpenAI Vision Guide](https://platform.openai.com/docs/guides/vision)
- [Claude Vision 文档](https://docs.anthropic.com/en/docs/build-with-claude/vision)
- [Gemini 多模态文档](https://ai.google.dev/gemini-api/docs/vision)
- [CLIP 论文 (OpenAI)](https://arxiv.org/abs/2103.00020)
- [Whisper 论文 (OpenAI)](https://arxiv.org/abs/2212.04356)
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) — 最强的图片/视频生成工作流
- [Fish Audio](https://github.com/fishaudio/fish-speech) — 中文 TTS
- [Stable Diffusion WebUI](https://github.com/AUTOMATIC1111/stable-diffusion-webui)
