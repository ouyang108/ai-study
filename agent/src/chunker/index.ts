import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { Document, DocumentChunk } from "../types/types.ts";
export interface ChunkConfig {
  // 每个块的最大字符数
  // 为什么选 500：中文文档中，500 字通常是 2-3 个段落，包含 1-2 个完整概念
  chunkSize: number;

  // 相邻块之间的重叠字符数
  // 为什么需要重叠：防止关键信息恰好落在两个块的分界处
  chunkOverlap: number;
}
const DEFAULT_CONFIG: ChunkConfig = {
  chunkSize: 500,
  chunkOverlap: 100,
};

// 文档数组分块
/**
 * @param documents 文档数组
 * @param config 分块配置
 * @returns 分块后的文档数组，每个文档包含多个 DocumentChunk
 */
export async function chunkDocuments(
  documents: Document[],
  config: ChunkConfig = DEFAULT_CONFIG,
) {
  //  第一优先级：\n\n（段落之间）—— 最好的分割点
  //   第二优先级：\n（行之间）
  //   第三优先级：。（中文句号）
  //   第四优先级：.（英文句号）

  const spliter = new RecursiveCharacterTextSplitter({
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    separators: ["\n\n", "\n", "。", "."],
  });

  const allChunks: DocumentChunk[] = [];
  for (const doc of documents) {
    // 跳过短文档
    if (doc.content.trim().length < 10) {
      continue;
    }
    // LangChain 的 splitText 进行分块
    const texts = await spliter.splitText(doc.content);
    // allChunks.push(...texts);
    // 普通字符串包装成项目里的标准结构 DocumentChunk 类
    const chunks: DocumentChunk[] = texts.map(
      (text: string, index: number) => ({
        content: text,
        metadata: {
          // 展开原始文档的所有元数据
          ...doc.metadata,
          // 添加分块特有信息  给每个 chunk 加编号
          chunkIndex: index,
          totalChunks: texts.length,
        },
      }),
    );

    allChunks.push(...chunks);
  }
  console.log(allChunks);
  return allChunks;
}
