// 检索器
// 根据用户查询，从向量数据库中检索最相关的文档块
import { ChromaClient } from "chromadb";
import { embedQuery } from "../embedder/index.ts";
import type { SearchResult, DocumentChunk } from "../types/types";

const chromaClient = new ChromaClient();
const COLLECTION_NAME = "knowledge_base";
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

// 检索
export async function search(
  query: string,
  config: RetrieveConfig = DEFAULT_RETRIEVE_CONFIG,
): Promise<SearchResult[]> {
  console.log(`  开始检索（${query}）`);
  //   查询向量化
  const queryVector = await embedQuery(query);

  // 第二步：从 ChromaDB 获取集合
  const collection = await chromaClient.getCollection({
    name: COLLECTION_NAME,
  });

  // 第三步：执行相似度检索
  // queryEmbeddings: 查询向量
  // nResults: 返回多少个结果（这里多取一些，后续可以过滤和排序）
  // 为什么多取一些：先宽松地取了，再用 scoreThreshold 过滤，比取少了再补取效率高
  const results: any = await collection.query({
    queryEmbeddings: [queryVector as number[]],
    nResults: Math.max(config.maxResults * 2, 10),
  });
  //  chromaDB返回的格式
  /**
   *    //   results.ids[0] = ["id1", "id2", ...]
  //   results.documents[0] = ["doc1", "doc2", ...]
  //   results.metadatas[0] = [{source: ...}, ...]
  //   results.distances[0] = [0.12, 0.34, ...]  ← 距离值（越小越相似）
   */
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
        page: metadata.page ? parseInt(metadata.page as string) : 0,
        chunkIndex: parseInt(metadata.chunkIndex as string),
        totalChunks: parseInt(metadata.totalChunks as string),
        fileType: metadata.fileType as string,
      },
    };

    searchResults.push({ chunk, score });
  }
  //   返回排序后的结果
  searchResults.sort((a, b) => b.score - a.score);

  // 限制返回数量
  const finalResults = searchResults.slice(0, config.maxResults);
  console.log(
    `  ✅ 找到 ${finalResults.length} 个相关结果（原始 ${searchResults.length} 个，过滤后保留）`,
  );

  // 打印每个结果的摘要，方便调试
  finalResults.forEach((result, index) => {
    const { source, page } = result.chunk.metadata;
    const preview =
      result.chunk.content.substring(0, 60).replace(/\n/g, " ") + "...";
    console.log(
      `    [${index + 1}] ${source}${page ? ` (第${page}页)` : ""} - 分数: ${result.score.toFixed(3)} - "${preview}"`,
    );
  });

  return finalResults;
}

/**
 * 简单检索——返回原始格式（用于需要直接操作 ChromaDB 返回值的场景）
 */
export async function searchRaw(
  query: string,
  nResults: number = 5,
): Promise<any> {
  const queryVector = await embedQuery(query);
  const collection = await chromaClient.getCollection({
    name: COLLECTION_NAME,
  });
  return await collection.query({
    queryEmbeddings: [queryVector as number[]],
    nResults,
  });
}
