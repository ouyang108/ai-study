// Embedding
import OpenAI from "openai";

const aliyunApiKey = process.env.ALIYUN_API_KEY;

if (!aliyunApiKey) {
  throw new Error("未设置 ALIYUN_API_KEY，请在 .env 文件中配置阿里云百炼 API Key");
}

const openai = new OpenAI({
  apiKey: aliyunApiKey,
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
});
export interface EmbedConfig {
  // 使用的嵌入模型名称
  //目前使用text-embedding-v4
  model: string;

  // 为什么可以降低维度：减少存储和计算成本，检索质量下降很小
  // 默认1024 text-embedding-v4
  dimensions?: number;
}
const DEFAULT_EMBED_CONFIG: EmbedConfig = {
  model: "text-embedding-v4",
};

const MAX_EMBED_BATCH_SIZE = 10;

export async function embed(
  text: string[],
  config: EmbedConfig = DEFAULT_EMBED_CONFIG,
): Promise<number[][]> {
  console.log(`  开始向量化（${text.length} 个文本落）`);
  if (text.length === 0) return [];
  try {
    const vectors: number[][] = [];

    for (let i = 0; i < text.length; i += MAX_EMBED_BATCH_SIZE) {
      const batch = text.slice(i, i + MAX_EMBED_BATCH_SIZE);
      const batchNo = Math.floor(i / MAX_EMBED_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(text.length / MAX_EMBED_BATCH_SIZE);

      console.log(
        `  向量化批次 ${batchNo}/${totalBatches}（${batch.length} 个文本段）`,
      );

      const response = await openai.embeddings.create({
        model: config.model,
        input: batch,
        dimensions: config.dimensions || 1024,
      });

      vectors.push(...response.data.map((item) => item.embedding));
    }

    console.log(`  ✅ 向量化完成（${vectors.length} 个向量）`);
    return vectors;
  } catch (error) {
    console.error(`  ❌ 向量化失败: ${(error as Error).message}`);
    throw error;
  }
}
export async function embedQuery(
  text: string,
  config: EmbedConfig = DEFAULT_EMBED_CONFIG,
) {
  const vectors = await embed([text], config);
  if (vectors) {
    return vectors[0];
  }
  return [];
}
