// 文档加载器
/**
 * 不同类型文件的内部结构完全不同：

- **TXT**：就是纯文本，直接读就行
- **Markdown**：也是纯文本，但可以预处理（去掉格式标记保留内容）
- **PDF**：二进制格式，文字、图片、表格混在一起，需要专门的解析库
 */

// Node.js 内置模块没有默认导出，使用命名空间导入（* as）
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, basename, join } from "node:path";

// pdf-parse ESM 版本导出的是 PDFParse 类，不是默认导出
import { PDFParse } from "pdf-parse";

// .js 扩展名：moduleResolution 为 node16/nodenext 时，相对导入必须带显式扩展名
import type { Document } from "../types/types.ts";

// 加载单个文件
function loadFile(filePath: string): Promise<Document[]> {
  //   先判断文件是否存在
  if (!existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }

  //   判断文件类型
  const ext = extname(filePath).toLowerCase();

  switch (ext) {
    case ".txt":
      return loadTxtFile(filePath);
    case ".md":
      return loadMdFile(filePath);
    case ".pdf":
      return loadPdfFile(filePath);
    default:
      throw new Error(`不支持的文件类型: ${ext}`);
  }
}

// txt 加载器
function loadTxtFile(filePath: string): Promise<Document[]> {
  // 读取buffer
  const buffer = readFileSync(filePath);
  const content = decodeBuffer(buffer);

  //   提取文件名作为来源
  const source = basename(filePath);
  return Promise.resolve([{ content, metadata: { source, fileType: "txt" } }]);
}

// md 加载器
function loadMdFile(filePath: string): Promise<Document[]> {
  // 读取buffer
  const buffer = readFileSync(filePath);
  const content = decodeBuffer(buffer);

  //   提取文件名作为来源
  const source = basename(filePath);
  return Promise.resolve([{ content, metadata: { source, fileType: "md" } }]);
}

// pdf 加载器
async function loadPdfFile(filePath: string): Promise<Document[]> {
  // 读取 PDF 二进制数据
  const buffer = readFileSync(filePath);
  // 提取文件名作为来源
  const source = basename(filePath);

  // Buffer 转为 Uint8Array：pdfjs-dist 5.x 不接受 Node.js Buffer，必须显式转换
  const uint8Array = new Uint8Array(buffer);
  // 加载 PDF 并解析文本
  const pdfData = new PDFParse(uint8Array);
  const result = await pdfData.getText();
  console.log(result.pages);
  // result.pages 已经按页分好了，每页包括 { num: 页码, text: 该页文本 }
  // 每页作为一个独立的 Document，方便后续按页检索
  const documents: Document[] = result.pages.map((page) => ({
    content: page.text,
    metadata: {
      source,
      fileType: "pdf",
      page: page.num, // 当前页码（对应 Document.metadata.page）
    },
  }));

  return documents;
}
// 先默认都是utf-8编码，后续再根据实际情况调整
function decodeBuffer(buffer: Buffer): string {
  return buffer.toString("utf-8");
}

/**
 * 加载单个文件（对外暴露的便捷接口）
 */
export async function loadSingleFile(filePath: string): Promise<Document[]> {
  console.log(`  正在加载: ${basename(filePath)}`);
  const docs = await loadFile(filePath);
  console.log(`  ✅ 加载完成（${docs.length}个段落）`);
  return docs;
}

// 文件夹
/**
 * 加载整个文件夹中的所有支持的文件
 * 为什么需要一个批量加载函数：用户可能一次性上传整个文件夹
 *
 * @param dirPath - 文件夹路径
 * @returns 所有文件解析后的 Document 数组（扁平化）
 */
export async function loadDirectory(dirPath: string): Promise<Document[]> {
  // 检查目录是否存在
  if (!existsSync(dirPath)) {
    throw new Error(
      `目录不存在: ${dirPath}（请先创建 documents 文件夹并放入文档）`,
    );
  }

  // 读取目录下所有条目
  const entries = readdirSync(dirPath, { withFileTypes: true });

  const allDocuments: Document[] = [];

  // 遍历每个条目
  for (const entry of entries) {
    // 跳过子目录（只处理文件，不做递归）
    // 为什么只处理文件不递归：简单可控，用户要递归的话把子目录里的文件移出来即可
    if (!entry.isFile()) continue;

    const filePath = join(dirPath, entry.name);
    const ext = extname(entry.name).toLowerCase();

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
      console.error(
        `  ❌ 加载失败: ${entry.name} —— ${(error as Error).message}`,
      );
    }
  }

  return allDocuments;
}
