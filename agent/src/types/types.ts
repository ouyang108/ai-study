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
    source: string; // 来源文件名
    page?: number; // 页码（如果有）
    snippet: string; // 引用的原文片段（截取前 100 字）
    score: number; // 相似度分数
  }>;

  // 检索到的相关文档块（完整信息，调试用）
  searchResults: SearchResult[];
}
