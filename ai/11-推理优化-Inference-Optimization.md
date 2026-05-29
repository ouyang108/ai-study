# LLM 推理优化

## 1. 为什么需要推理优化

LLM 推理（Inference）消耗巨大：
- 一次 GPT-4 级别推理 = 几秒到几十秒
- 1 个 70B 参数模型 = 140GB 显存（FP16）
- 高并发时 GPU 资源严重不足

优化目标：**更快、更省、能承载更多并发**

## 2. 优化全景图

```
推理优化
├── 模型量化 (Quantization)
│   ├── GPTQ (GPU 量化)
│   ├── AWQ (激活感知量化)
│   ├── GGUF/GGML (CPU 量化)
│   └── bitsandbytes (训练+推理)
│
├── 推理引擎加速
│   ├── vLLM (PagedAttention + 连续批处理)
│   ├── TensorRT-LLM (NVIDIA 官方)
│   ├── SGLang (高吞吐)
│   ├── llama.cpp (CPU 推理)
│   └── Ollama (用户友好封装)
│
├── 注意力机制优化
│   ├── Flash Attention (显存+速度双优化)
│   ├── PagedAttention (KV Cache 分页管理)
│   └── Multi-Query / Grouped-Query Attention
│
├── 批处理策略
│   ├── 连续批处理 (Continuous Batching)
│   ├── 动态批处理 (Dynamic Batching)
│   └── Speculative Decoding (投机解码)
│
└── 分布式推理
    ├── 张量并行 (Tensor Parallelism)
    ├── 流水线并行 (Pipeline Parallelism)
    └── 数据并行 (Data Parallelism)
```

## 3. 模型量化详解

### 3.1 量化是什么

把模型参数从高精度（FP16: 2 字节）降低到低精度（INT4: 0.5 字节），**显存减少 75%，速度提升 2-4 倍，质量损失可控**。

```
FP16  →  每个参数 16 bit = 2 bytes
INT8  →  每个参数  8 bit = 1 byte  （显存减半，质量基本不降）
INT4  →  每个参数  4 bit = 0.5 byte（显存减少 75%，质量轻微下降）
```

### 3.2 量化方案对比

| 方案 | 精度 | 显存 (70B模型) | 速度 | 质量损失 | 适用场景 |
|------|------|---------------|------|----------|----------|
| FP16 (原始) | 16-bit | ~140 GB | 基准 | 无 | A100/H100 多卡 |
| INT8 (动态量化) | 8-bit | ~70 GB | 1.5-2x | 极低 (<0.5%) | 单卡 A100 80GB |
| INT4 (GPTQ) | 4-bit | ~35 GB | 2-3x | 低 (1-3%) | 单卡 A6000 48GB |
| INT4 (AWQ) | 4-bit | ~35 GB | 2-3x | 低 (1-2%) | 比 GPTQ 好，推荐 |
| INT4 (GGUF) | 4-bit | ~35 GB | 1-2x (CPU) | 低 (1-3%) | CPU 推理/Mac |

### 3.3 量化实战

```bash
# === 方案A: AWQ 量化（推荐，GPU部署） ===
# Node.js 没有 AWQ 原生库，量化操作需通过 Python CLI 完成
# pip install autoawq

# 使用 Python 脚本执行 AWQ 量化
python -c "
from awq import AutoAWQForCausalLM
from transformers import AutoTokenizer

model_path = 'Qwen/Qwen2.5-7B-Instruct'
quant_path = './qwen2.5-7b-awq'

# 量化
model = AutoAWQForCausalLM.from_pretrained(model_path)
tokenizer = AutoTokenizer.from_pretrained(model_path)

# 配置量化参数
quant_config = {
    'zero_point': True,      # 零点量化，提高精度
    'q_group_size': 128,     # 分组大小，128 是常用值
    'w_bit': 4,              # 4-bit 量化
    'version': 'GEMM',       # GEMM 内核，推理快
}

model.quantize(tokenizer, quant_config=quant_config)
model.save_quantized(quant_path)
print('量化完成，模型已保存到', quant_path)
"
```

量化完成后，通过 vLLM 或 Ollama 等推理引擎加载量化模型进行推理（见下方章节）。

```bash
# === 方案B: GGUF 量化（CPU/Mac 部署） ===
# 用 Ollama 一行命令搞定
# ollama run qwen2.5:7b  # 自动下载量化版

# 或者转 GGUF 后自己用 llama.cpp 推理
# python convert.py model --outtype q4_K_M  # Q4_K_M 是性价比最高的 GGUF 量化
```

### 3.4 各种量化精度的显存估算

```
模型大小 → 单卡能跑什么精度

70B 模型:
  FP16:     140 GB → 需要 2×A100 或 4×A6000
  INT8:      70 GB → 需要 1×A100 80GB
  INT4(GPTQ/AWQ): 35 GB → 需要 1×A6000 48GB
  Q4_K_M(GGUF):   38 GB → 需要 64GB Mac M2 Ultra / 2×24GB GPU

32B 模型:
  FP16:      64 GB → 需要 1×A100 80GB
  INT4:      16 GB → 需要 1×RTX 4090 24GB ✓ 单卡消费级可跑
  Q4_K_M:    18 GB → 需要 32GB Mac M2 Pro / 1×RTX 4090

7B 模型:
  FP16:      14 GB → 需要 1×RTX 3090 24GB
  INT4:       4 GB → 需要 1×RTX 3060 12GB ✓ 老卡也能跑
  Q4_K_M:     5 GB → 需要 16GB Mac M1 / 1×RTX 2060
```

## 4. 推理引擎对比

| 引擎 | 吞吐量 | 适用场景 | 特点 |
|------|--------|----------|------|
| **vLLM** | 极高 | GPU 高并发服务 | PagedAttention，连续批处理，业界标准 |
| **SGLang** | 极高 | GPU 高并发服务 | RadixAttention，结构化生成 |
| **TensorRT-LLM** | 最高 | NVIDIA GPU 极致优化 | NVIDIA 官方，优化到极致但配置复杂 |
| **llama.cpp** | 中 | CPU/Mac 推理 | CPU 优化，消费级硬件可用 |
| **Ollama** | 低-中 | 个人/开发测试 | 基于 llama.cpp，一行命令启动 |
| **HuggingFace TGI** | 高 | 标准化部署 | HuggingFace 出品，生态好 |
| **LMDeploy** | 高 | 模型部署 | 上海 AI Lab，TurboMind 引擎 |
| **Xinference** | 中 | 多模型统一部署 | 国产开源，Web UI 管理 |

### 4.1 vLLM 部署实战

```bash
# 安装
# pip install vllm

# === 方式1: 启动 vLLM OpenAI 兼容 API 服务器 ===
# vLLM 提供 OpenAI 兼容的 REST API，Node.js/TypeScript 通过 HTTP 调用
vllm serve Qwen/Qwen2.5-32B-Instruct-AWQ \
  --tensor-parallel-size 1 \
  --gpu-memory-utilization 0.90 \
  --max-model-len 8192 \
  --port 8000
```

```typescript
// === 方式2: Node.js 通过 OpenAI 兼容 API 调用 vLLM ===
import OpenAI from "openai";

// vLLM 的 OpenAI 兼容 API，baseURL 指向 vLLM 服务器
const client = new OpenAI({
    baseURL: "http://localhost:8000/v1",
    apiKey: "not-needed",  // vLLM 本地部署不需要真实 API Key
});

async function generate() {
    const response = await client.chat.completions.create({
        model: "Qwen/Qwen2.5-32B-Instruct-AWQ",
        messages: [
            { role: "user", content: "介绍一下深度学习" },
        ],
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 512,
    });
    console.log(response.choices[0].message.content);
}

generate();

// 批量生成多个 prompt
async function batchGenerate(prompts: string[]) {
    for (const prompt of prompts) {
        const response = await client.chat.completions.create({
            model: "Qwen/Qwen2.5-32B-Instruct-AWQ",
            messages: [{ role: "user", content: prompt }],
        });
        console.log(response.choices[0].message.content);
    }
}

batchGenerate(["介绍一下深度学习", "什么是Transformer"]);
```

### 4.2 Ollama 使用

```bash
# 一行命令启动模型（自动下载量化版）
ollama run qwen2.5:32b        # Q4_K_M 量化, ~20GB
ollama run deepseek-r1:32b    # DeepSeek R1 蒸馏版
ollama run llama3.2:latest    # 最新 Llama

# OpenAI 兼容 API 自动暴露在 http://localhost:11434
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "qwen2.5:32b", "messages": [{"role": "user", "content": "你好"}]}'
```

```typescript
// Node.js 调用 Ollama（OpenAI 兼容 API）
import OpenAI from "openai";

const client = new OpenAI({
    baseURL: "http://localhost:11434/v1",
    apiKey: "ollama",  // Ollama 不需要真实 key
});

const response = await client.chat.completions.create({
    model: "qwen2.5:32b",
    messages: [{ role: "user", content: "你好" }],
});
console.log(response.choices[0].message.content);
```

## 5. Flash Attention — 显存和速度双优化

```typescript
// Flash Attention 是注意力机制的优化实现
// 传统方法: O(n²) 显存复杂度
// Flash Attention: O(n) 显存复杂度，且更快
//
// 大多数框架已经默认启用 Flash Attention
// vllm 默认开启
// transformers 4.40+ 默认开启（如果有 flash-attn）
// pip install flash-attn --no-build-isolation
//
// 效果（以 Llama-7B, 4096 context 为例）:
// 显存: 24GB → 16GB (节省 33%)
// 速度: 1.5-2x 加速
// 长上下文场景提升更明显：8192 context 时速度提升可达 3-5x
// 
// Node.js 端无需特殊配置，推理引擎（vLLM 等）在服务端已自动启用
```

## 6. Speculative Decoding（投机解码）

```bash
# 用小模型 "猜" 接下来几个 token，大模型 "审核"，快 2-3 倍
#
# 原理:
# 大模型每步生成 1 个 token（慢但准）
# 小模型每步生成 1 个 token（快但不够准）
# 投机解码: 小模型提前猜 5 个 token → 大模型一次审核 5 个 → 通过的直接用
#
# vLLM 中启用投机解码（通过 CLI 启动参数）
vllm serve Qwen/Qwen2.5-72B-Instruct \
  --speculative-model Qwen/Qwen2.5-1.5B-Instruct \
  --num-speculative-tokens 5 \
  --port 8000
# 效果: 延迟降低 40-60%，吞吐量提升 2-3x
```

```typescript
// Node.js 客户端代码无需变化，投机解码在服务端透明生效
import OpenAI from "openai";

const client = new OpenAI({
    baseURL: "http://localhost:8000/v1",
    apiKey: "not-needed",
});

// 发送请求，vLLM 服务端自动使用投机解码加速
const response = await client.chat.completions.create({
    model: "Qwen/Qwen2.5-72B-Instruct",
    messages: [{ role: "user", content: "请详细解释量子计算的基本原理" }],
    max_tokens: 1024,
});
console.log(response.choices[0].message.content);
```

## 7. 性能调优总结

| 瓶颈 | 解决方案 |
|------|----------|
| 显存不够 | 量化 (GPTQ/AWQ/GGUF) + Flash Attention |
| 推理太慢 | vLLM/SGLang + 投机解码 + Flash Attention |
| 并发太低 | Continuous Batching + 多实例 |
| 长文本慢 | Flash Attention + 量化 + GQA |
| 冷启动慢 | 模型预热 + 常驻内存 |
| 成本高 | 量化 + 选择性价比模型（见 10-模型选型-Model-Selection.md） |
| 中文质量差 | 换 Qwen/DeepSeek，不要用 Llama 做中文 |

## 8. 推荐文章

- [vLLM 官方文档](https://docs.vllm.ai/) — 必读的推理引擎文档
- [Flash Attention 论文](https://arxiv.org/abs/2205.14135)
- [PagedAttention 论文 (vLLM)](https://arxiv.org/abs/2309.06180)
- [AWQ 论文](https://arxiv.org/abs/2306.00978)
- [GPTQ 论文](https://arxiv.org/abs/2210.17323)
- [llama.cpp](https://github.com/ggerganov/llama.cpp) — CPU 推理鼻祖
- [vLLM GitHub](https://github.com/vllm-project/vllm)
- [SGLang GitHub](https://github.com/sgl-project/sglang)
- [Ollama GitHub](https://github.com/ollama/ollama)
- [LMDeploy GitHub](https://github.com/InternLM/lmdeploy)
