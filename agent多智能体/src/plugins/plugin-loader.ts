// 读取 manifest.json。
import { readFile } from "node:fs/promises";
// 把本地文件路径转换成 file:// URL，供动态 import 使用。
import { pathToFileURL } from "node:url";
// 路径工具。
import { dirname, join, resolve } from "node:path";
// 引入 manifest schema 和插件模块类型。
import {
  PluginManifestSchema,
  type PluginManifest,
  type PluginModule,
} from "./plugin-types";
// 引入工具注册中心。
import type { ToolRegistry } from "../tools/tool-registry";
/**
 * 插件加载器。
 * 负责读取插件 manifest、动态导入插件入口、执行生命周期、注册插件工具。
 */
export class PluginLoader {
  /** @param toolRegistry 工具注册中心，插件工具会注册到这里。 */
  constructor(private readonly toolRegistry: ToolRegistry) {}

  /** 加载一个插件目录。 */
  async load(pluginDir: string): Promise<PluginManifest> {
    // 插件清单固定为 manifest.json。
    const manifestPath = join(pluginDir, "manifest.json");
    // 读取并校验 manifest。
    const manifest = PluginManifestSchema.parse(
      JSON.parse(await readFile(manifestPath, "utf8")),
    );

    // 根据 manifest.entry 计算插件入口绝对路径。
    const entryPath = resolve(dirname(manifestPath), manifest.entry);
    // 动态 import 插件入口模块。
    const module = (await import(
      pathToFileURL(entryPath).href
    )) as PluginModule;

    // 如果插件提供 onLoad，则先执行初始化逻辑。
    await module.onLoad?.();

    // 如果插件提供工具，则逐个注册到工具注册中心。
    for (const tool of module.getTools?.() ?? []) {
      this.toolRegistry.register(tool);
    }

    // 返回 manifest，方便上层展示插件信息。
    return manifest;
  }
}
