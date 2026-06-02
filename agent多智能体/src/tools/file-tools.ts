// 文件相关工具
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
// dirname 用于创建父目录，resolve 用于安全地计算绝对路径。
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "../type/type";

/**
 * 检查目标文件是否存在于workspace内
 * 沙箱环境下，只能操作workspace内的文件，不能操作其他目录
 */
function isSafePath(targetPath: string, workspaceDir: string): string {
  const fullPath = resolve(workspaceDir, targetPath);
  const rootPath = resolve(workspaceDir);
  //   如果目标路径不是以workspaceDir开头，抛出错误
  if (!fullPath.startsWith(rootPath)) {
    throw new Error(`Unsafe path: ${targetPath} is outside of the workspace.`);
  }
  return fullPath;
}
/**
 * 把“说明书”抽出来塞给 LLM：框架会读取 return 对象里的 name、description 和 parameters（Zod 校验器），把它们转成 JSON Schema 喂给大模型。大模型由此学会了怎么读写文件。
 * 一旦大模型发出了 {"name": "write_file", "arguments": {...}} 的指令，外层框架就会立刻执行 return 数组里对应的 handler(argus) 函数
 * @param workspaceDir
 * @returns
 */
// 创建 文件相关工具
export function createFileTools(workspaceDir: string): ToolDefinition[] {
  return [
    {
      name: "read_file",
      description: "Read a UTF-8 file inside workspace.",
      //   读文件没有副作用
      sideEffect: false,
      //   参数
      parameters: z.object({
        path: z.string(),
      }),
      async handler(argus) {
        const fullPath = isSafePath(String(argus.path), workspaceDir);
        return {
          success: true,
          content: await readFile(fullPath, "utf-8"),
        };
      },
    },
    // 写文件工具
    {
      name: "write_file",
      description: "Write a UTF-8 file inside workspace.",
      // 写文件有副作用
      sideEffect: true,
      parameters: z.object({
        path: z.string(),
        content: z.string(),
      }),
      async handler(argus) {
        const fullPath = isSafePath(String(argus.path), workspaceDir);
        // 由于需要撤回，所有先保留源文件内容
        let prevContent: string | null = null;
        try {
          prevContent = await readFile(fullPath, "utf-8");
        } catch {
          // 文件不存在，prevContent 保持为 null
          prevContent = null;
        }
        await mkdir(dirname(fullPath), { recursive: true });
        // 写入内容
        await writeFile(fullPath, String(argus.content), "utf-8");
        return {
          // 等如果需要undo的时候，将undo里面的工具给予agent调用
          success: true,
          data: { path: fullPath },
          //   如果本来没有这个文件，撤回时需要删除它；如果本来有这个文件，撤回时需要恢复原内容
          undoInfo:
            prevContent === null
              ? {
                  action: "reverse",
                  reverseCall: {
                    toolName: "delete_file",
                    args: { path: String(argus.path) },
                  },
                }
              : {
                  action: "reverse",
                  reverseCall: {
                    toolName: "write_file",
                    args: { path: String(argus.path), content: prevContent },
                  },
                },
        };
      },
    },
    // 删除文件工具
    {
      name: "delete_file",
      description: "Delete a UTF-8 file inside workspace.",
      // 删除文件有副作用
      sideEffect: true,
      parameters: z.object({
        path: z.string(),
      }),
      async handler(argus) {
        const fullPath = isSafePath(String(argus.path), workspaceDir);
        // 删除前保存旧内容，方便撤销恢复。
        const previous = await readFile(fullPath, "utf8").catch(() => null);
        // 删除文件；force=true 表示文件不存在也不报错。
        await rm(fullPath, { force: true });
        return {
          success: true,
          data: { path: fullPath },
          undoInfo:
            previous === null
              ? undefined
              : {
                  action: "reverse",
                  reverseCall: {
                    toolName: "write_file",
                    args: { path: String(argus.path), content: previous },
                  },
                },
        };
      },
    },
  ];
}
