// 实现命令执行
// spawn 用于执行外部命令。
import { spawn } from "node:child_process";
import { z } from "zod";
import type { ToolDefinition } from "../type/type";

/**
 * 命令白名单。
 * MVP 阶段只允许常见开发命令，防止 Agent 执行高危系统命令。
 */
const ALLOWED_COMMANDS = new Set(["node", "npm", "git", "npx"]);

// 创建shell工具
export function createShellTools(workspaceDir: string): ToolDefinition[] {
  return [
    {
      name: "run_shell",
      description: "Run an allow-listed shell command inside workspace.",
      sideEffect: true,
      parameters: z.object({
        command: z.string(),
        args: z.array(z.string()).default([]),
      }),
      async handler(argus) {
        const command = String(argus.command);
        const commandArgs = Array.isArray(argus.args)
          ? argus.args.map(String)
          : [];
        //   如果命令不在白名单里，抛出错误
        if (!ALLOWED_COMMANDS.has(command)) {
          return {
            success: false,
            error: `Command is not allow-listed: ${command}`,
          };
        }
        //   子进程执行
        const result = await new Promise<{
          code: number | null;
          output: string;
        }>((resolve) => {
          const child = spawn(command, commandArgs, {
            shell: false,
            // stdio: ["ignore", "pipe", "pipe"],
            cwd: workspaceDir,
          });
          let output = "";
          //   监听子进程输出
          child.stdout.on("data", (data) => {
            output += data.toString();
          });
          //   监听子进程错误输出
          child.stderr.on("data", (data) => {
            output += data.toString();
          });

          child.on("close", (code) => {
            resolve({ code, output });
          });
        });
        return {
          success: result.code === 0,
          data: result,
          error: result.code === 0 ? undefined : result.output,
        };
      },
    },
  ];
}
