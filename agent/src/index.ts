//  =================================================================
//  index.ts —— 主入口 / 命令行交互界面
//  职责：启动程序、处理用户输入、协调各模块
//  为什么这是入口文件：将所有模块串联起来，暴露给用户的唯一界面
//  =================================================================

// 加载环境变量——ESM 静态导入会先执行依赖模块，所以必须用 side-effect import
// 为什么不用 dotenv.config()：普通代码会晚于其他静态 import 执行
import "dotenv/config";

// readline：Node.js 内置模块，用于创建命令行交互界面
// 为什么用 readline：零依赖，够用，支持逐行读取用户输入
import * as readline from "readline";
import * as path from "path";
import * as fs from "fs";

// 导入各功能模块
import { loadSingleFile, loadDirectory } from "./loader/index.ts";
import { chunkDocuments } from "./chunker/index.ts";
import { embed } from "./embedder/index.ts";
import {
  initializeStore,
  storeChunks,
  clearStore,
  getStoreCount,
} from "./store/index.ts";
import { askQuestion } from "./qa/index.ts";
import type { QAResponse } from "./types/types.ts";

//  =================================================================
//  配置
//  =================================================================

// 文档目录——用户把要导入的文档放在这个文件夹里
// 为什么用相对路径：方便，无论项目在哪里都能找到
const DOCUMENTS_DIR = path.resolve(process.cwd(), "../documents");

//  =================================================================
//  全局状态
//  =================================================================

// 保存最后一次问答的结果，用于 :sources 命令查看来源
// 为什么需要保留历史状态：用户回答完一个问题后可能会想要查看来源细节
let lastResponse: QAResponse | null = null;

//  =================================================================
//  工具函数
//  =================================================================

/**
 * 导入文档流程——将 documents 目录下的所有文档导入知识库
 * 为什么需要这个函数：用户新增文档后，需要一键导入
 * 流程：清空旧数据 → 加载文档 → 分块 → 向量化 → 存储
 */
async function importDocuments() {
  console.log("\n📂 开始导入文档...\n");

  // 检查 documents 目录是否存在
  if (!fs.existsSync(DOCUMENTS_DIR)) {
    // 目录不存在，自动创建
    // 为什么不直接报错：给用户一个明显的提示，减少挫败感
    fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
    console.log(`⚠️  文档目录 "${DOCUMENTS_DIR}" 不存在，已自动创建。`);
    console.log("   请将需要导入的文档放入该目录后重新运行 :import\n");
    return;
  }

  try {
    // 步骤 1：清空知识库旧数据
    // 为什么先清空：避免新旧数据混合，保证知识库数据的一致性
    // 注意：这会删除所有已存储的文档块！如果只需要增量添加，要用更细粒度的操作
    console.log("步骤 1/5: 清空知识库...");
    await clearStore();
    await initializeStore();

    // 步骤 2：加载文档——从文件系统读取原始内容
    console.log("\n步骤 2/5: 加载文档...");
    const documents = await loadDirectory(DOCUMENTS_DIR);

    if (documents.length === 0) {
      console.log("⚠️  没有找到可导入的文档（支持格式: .txt, .md, .pdf）");
      console.log(`   请将文档放入 "${DOCUMENTS_DIR}" 目录\n`);
      return;
    }

    // 步骤 3：分块——将长文档切成固定大小的语义块
    console.log("\n步骤 3/5: 文本分块...");
    const chunks = await chunkDocuments(documents);

    if (chunks.length === 0) {
      console.log("⚠️  没有可用的文本块（文档内容可能太短或为空）\n");
      return;
    }

    // 步骤 4：向量化——将文本转为向量
    // 为什么文本切片后先提取内容数组：embedTexts 接受 string[]，需要统一格式
    console.log("\n步骤 4/5: 向量化...");
    const texts = chunks.map((chunk) => chunk.content);
    const vectors = await embed(texts);

    // 步骤 5：存储——将向量和文本存入 ChromaDB
    console.log("\n步骤 5/5: 存储到向量数据库...");
    await storeChunks(chunks, vectors);

    // 导入完成，显示统计
    const count = await getStoreCount();
    console.log(`\n🎉 导入完成！知识库现有 ${count} 条记录。\n`);
  } catch (error) {
    console.error(`\n❌ 导入失败: ${(error as Error).message}`);
    console.error("   请检查:");
    console.error("   1. documents 目录下是否有文件？");
    console.error("   2. .env 文件中的 OPENAI_API_KEY 是否有效？");
    console.error("   3. ChromaDB 服务是否在运行？\n");
  }
}

/**
 * 处理用户提问
 */
async function handleAsk(query: string) {
  // 检查知识库是否有数据
  const count = await getStoreCount();
  if (count === 0) {
    console.log('⚠️  知识库为空！请先使用 ":import" 导入文档。\n');
    return;
  }

  try {
    // 调用问答引擎
    lastResponse = await askQuestion({ query });

    // 输出答案
    console.log("═══════════════════════════════════════════");
    console.log("📋 回答：\n");
    console.log(lastResponse.answer);
    console.log("\n═══════════════════════════════════════════");

    // 输出简短的来源摘要
    console.log(`\n📎 参考了 ${lastResponse.sources.length} 个来源：`);
    lastResponse.sources.forEach((s, i) => {
      console.log(
        `   [${i + 1}] ${s.source}${s.page ? ` (第${s.page}页)` : ""} (相似度: ${s.score.toFixed(2)})`,
      );
    });
    console.log('   输入 ":sources" 查看更多来源细节\n');
  } catch (error) {
    console.error(`\n❌ 提问失败: ${(error as Error).message}\n`);
  }
}

/**
 * 显示来源详情
 */
function showSources() {
  if (!lastResponse) {
    console.log("⚠️  还没有进行过问答，无法显示来源。请先提问。\n");
    return;
  }

  console.log("\n═══════════════════════════════════════════");
  console.log("📎 来源详情：\n");

  lastResponse.sources.forEach((s, i) => {
    console.log(`[${i + 1}] ${s.source}${s.page ? ` (第${s.page}页)` : ""}`);
    console.log(`   相似度: ${s.score.toFixed(3)}`);
    console.log(`   预览: ${s.snippet}...`);
    console.log("");
  });
  console.log("═══════════════════════════════════════════\n");
}

/**
 * 上传单个文件到 documents 目录
 */
async function handleUpload(filePath: string) {
  if (!fs.existsSync(filePath)) {
    console.log(`❌ 文件不存在: ${filePath}\n`);
    return;
  }

  // 检查文件格式
  const ext = path.extname(filePath).toLowerCase();
  if (![".txt", ".md", ".pdf"].includes(ext)) {
    console.log(`❌ 不支持的文件格式: ${ext}（支持 .txt, .md, .pdf）\n`);
    return;
  }

  // 确保 documents 目录存在
  if (!fs.existsSync(DOCUMENTS_DIR)) {
    fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
  }

  // 复制文件到 documents 目录
  const fileName = path.basename(filePath);
  const destPath = path.join(DOCUMENTS_DIR, fileName);
  fs.copyFileSync(filePath, destPath);
  console.log(`✅ 文件已复制到: ${destPath}`);
  console.log('   请使用 ":import" 将其导入知识库\n');
}

/**
 * 显示帮助信息
 */
function showHelp() {
  console.log("\n═══════════════════════════════════════════");
  console.log("📚 个人知识库问答系统 - 使用说明");
  console.log("═══════════════════════════════════════════\n");
  console.log("命令列表：");
  console.log("  :ask <问题>     向知识库提问");
  console.log("  :import          导入 documents 目录下的所有文档");
  console.log("  :upload <路径>   上传一个文件到 documents 目录");
  console.log("  :sources         显示上次回答的来源详情");
  console.log("  :count           查看知识库中的文档块数量");
  console.log("  :help            显示此帮助信息");
  console.log("  :quit            退出程序\n");
  console.log("使用步骤：");
  console.log("  1. 将文档放入 documents/ 目录（或用 :upload）");
  console.log("  2. 运行 :import 导入文档");
  console.log("  3. 使用 :ask <问题> 开始提问\n");
  console.log("═══════════════════════════════════════════\n");
}

//  =================================================================
//  主程序
//  =================================================================

async function main() {
  // 检查必要的环境变量
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ 错误：未设置 OPENAI_API_KEY");
    console.error("   请在 .env 文件中配置你的 OpenAI API Key\n");
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════");
  console.log("📚 个人知识库问答系统");
  console.log("═══════════════════════════════════════════");
  console.log('输入 ":help" 查看可用命令\n');

  // 初始化向量数据库连接
  try {
    await initializeStore();
    const count = await getStoreCount();
    console.log(`ℹ️  知识库状态: ${count} 条记录`);
    if (count === 0) {
      console.log('   请将文档放入 documents/ 目录后运行 ":import" 导入\n');
    } else {
      console.log('   输入 ":ask <问题>" 开始提问\n');
    }
  } catch (error) {
    console.error("❌ 无法连接到 ChromaDB");
    console.error("   请确保 ChromaDB 服务已启动: chroma run\n");
    process.exit(1);
  }

  // 创建 readline 交互界面
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "🤔 > ",
  });

  rl.prompt();

  // 监听用户输入
  rl.on("line", async (line: string) => {
    const input = line.trim();

    // 空行忽略
    if (!input) {
      rl.prompt();
      return;
    }

    // 解析命令
    if (input.startsWith(":ask ")) {
      // 提取问题（去掉 ":ask " 前缀）
      const query = input.slice(5).trim();
      if (!query) {
        console.log("⚠️  请输入问题，例如：:ask 机器学习是什么？\n");
      } else {
        await handleAsk(query);
      }
    } else if (input.startsWith(":upload ")) {
      const filePath = input.slice(8).trim();
      await handleUpload(filePath);
    } else if (input === ":sources") {
      showSources();
    } else if (input === ":import") {
      await importDocuments();
    } else if (input === ":count") {
      const count = await getStoreCount();
      console.log(`ℹ️  知识库当前有 ${count} 条文档记录\n`);
    } else if (input === ":help") {
      showHelp();
    } else if (input === ":quit") {
      console.log("👋 再见！");
      rl.close();
      process.exit(0);
    } else {
      console.log(`⚠️  未知命令: "${input}"。输入 ":help" 查看可用命令。\n`);
    }

    rl.prompt();
  });

  // 处理 Ctrl+C（SIGINT）
  rl.on("SIGINT", () => {
    console.log("\n👋 再见！");
    rl.close();
    process.exit(0);
  });
}

// 启动主程序
// 为什么用 .catch 处理顶层错误：main 是 async 函数，未捕获的 Promise rejection
// 如果不处理，Node.js 会打印警告但不会退出，可能让用户困惑
main().catch((error) => {
  console.error("程序异常退出:", error.message);
  process.exit(1);
});
