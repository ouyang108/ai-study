// Zod 用于校验插件 manifest.json。
import { z } from "zod";
// 插件可以返回工具定义，因此引入 ToolDefinition。
import type { ToolDefinition } from "../type/type";

/**
 * 插件 manifest 校验 schema。
 * 每个插件目录必须包含 manifest.json，并符合这个结构。
 */
export const PluginManifestSchema = z.object({
  // 插件唯一名称。
  name: z.string(),
  // 插件版本。
  version: z.string(),
  // 插件类型：工具、Agent、中间件、模型 Provider。
  type: z.enum(["tool", "agent", "middleware", "provider"]),
  // 插件描述。
  description: z.string(),
  // 插件作者，可选。
  author: z.string().optional(),
  // 插件入口文件，例如 index.js。
  entry: z.string(),
  // 插件声明提供的工具列表，用于展示和权限管理。
  tools: z
    .array(
      z.object({
        // 工具名称。
        name: z.string(),
        // 工具描述。
        description: z.string(),
        // 工具参数描述。这里用宽松结构，真正运行时建议用 Zod 或 JSON Schema。
        parameters: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .default([]),
  // 插件需要的环境变量名称列表。
  envVars: z.array(z.string()).default([]),
});

/** 插件 manifest TypeScript 类型。 */
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/**
 * 插件模块接口。
 * 插件入口文件可以导出这些生命周期方法和能力方法。
 */
export interface PluginModule {
  /** 插件加载时调用，例如初始化连接、读取配置。 */
  onLoad?: () => Promise<void> | void;
  /** 插件卸载时调用，例如关闭连接、释放资源。 */
  onUnload?: () => Promise<void> | void;
  /** 返回插件提供的工具列表。 */
  getTools?: () => ToolDefinition[];
}
