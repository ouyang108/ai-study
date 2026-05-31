// 向量存储
import { ChromaClient } from "chromadb";
import type { DocumentChunk } from "../types/types";
// 默认连接 http://localhost:8000
const client = new ChromaClient();
const COLLECTION_NAME = "knowledge_base";

// 初始化集合
export async function initializeStore() {
  try {
    // 尝试获取已有集合
    // 为什么先获取：如果集合已经存在（第二次启动），直接复用，不重建
    await client.getCollection({ name: COLLECTION_NAME });
    console.log(`  ✅ 连接到已有集合: ${COLLECTION_NAME}`);
  } catch {
    // 集合不存在，创建新的
    // 第一次运行时走到这里
    await client.createCollection({ name: COLLECTION_NAME });
    console.log(`  ✅ 创建新集合: ${COLLECTION_NAME}`);
  }
}

/**
 * 存入向量数据
 * @param chunks 分块了的文档块数组
 * @param vectors 对应的向量数组
 */
export async function storeChunks(
  chunks: DocumentChunk[],
  vectors: number[][],
) {
  // 数据校验
  if (chunks.length !== vectors.length) {
    throw new Error(
      `数据不匹配:chunks 有 ${chunks.length} 个，但 vectors 有 ${vectors.length} 个`,
    );
  }
  if (chunks.length === 0) {
    console.log("  ⚠️  没有内容需要存储");
    return;
  }
  // 获取集合
  const collection = await client.getCollection({
    name: COLLECTION_NAME,
  });
  //   唯一标识每个文档块
  const ids = chunks.map((chunk) => {
    const source = chunk.metadata.source.replace(/\.[^.]+$/, ""); // 移除后缀
    const page = chunk.metadata.page ? `-p${chunk.metadata.page}` : "";
    const index = `-c${chunk.metadata.chunkIndex}`;
    return `${source}${page}${index}`;
  });
  //   分块文本内容
  const documentsContent = chunks.map((chunk) => chunk.content);
  const metadatas = chunks.map((chunk) => ({
    source: chunk.metadata.source,
    page: chunk.metadata.page?.toString() || "",
    chunkIndex: chunk.metadata.chunkIndex.toString(),
    totalChunks: chunk.metadata.totalChunks.toString(),
    fileType: chunk.metadata.fileType || "",
  }));
  await collection.add({
    ids,
    embeddings: vectors,
    documents: documentsContent,
    metadatas,
  });
  console.log(`  ✅ 已存储 ${chunks.length} 个文档块到向量数据库`);
}
// 清空集合
export async function clearStore() {
  try {
    await client.deleteCollection({ name: COLLECTION_NAME });
    console.log(`  ✅ 已清空集合: ${COLLECTION_NAME}`);
  } catch {
    // 如果集合本身就不存在，忽略错误
    // 为什么忽略：第一次使用就调 clear 也不会报错
    console.log(`  ℹ️  集合不存在，无需清空`);
  }
  // 重新创建空集合
  await client.createCollection({ name: COLLECTION_NAME });
}
/**
 * 获取集合中的文档块数量
 *
 */
export async function getStoreCount(): Promise<number> {
  try {
    const collection = await client.getCollection({
      name: COLLECTION_NAME,
    });
    return await collection.count();
  } catch {
    return 0;
  }
}
// 查看知识库中的一些样本数据（调试用）
export async function peekStore(limit: number = 5) {
  try {
    const collection = await client.getCollection({
      name: COLLECTION_NAME,
    });
    const result = await collection.peek({ limit });
    return result;
  } catch {
    console.log("  ℹ️  集合为空或不存在");
    return null;
  }
}
