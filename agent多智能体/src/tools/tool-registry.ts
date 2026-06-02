// 统一注册文件,shell等工具
import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../type/type";

// 工具注册
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  //   注册工具
  register(tool: ToolDefinition) {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool with name ${tool.name} is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }
  //   列出所有已注册的工具
  list() {
    return Array.from(this.tools.values());
  }
  //   根据名称获取工具
  get(name: string) {
    return this.tools.get(name);
  }
  //   调用工具
  async call(name: string, arg: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Tool with name ${name} is not registered.`);
    }
    //   校验参数
    if (tool.parameters instanceof z.ZodType) {
      const parsed = tool.parameters.safeParse(arg);
      if (!parsed.success) {
        return {
          success: false,
          error: `Invalid arguments for tool ${name}: ${parsed.error.message}`,
        };
      }
      return tool.handler(parsed.data as Record<string, unknown>);
    }
    // 如果不是zod类型，直接调用工具
    return tool.handler(arg);
  }
}
