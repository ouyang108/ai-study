export interface LlmMessage {
  /** 消息角色：system 定规则，user 给任务，assistant 放历史回复。 */
  role: "system" | "user" | "assistant";
  /** 消息正文。 */
  content: string;
}

/**
 * LLM Provider 抽象接口。
 * OpenAI、Anthropic、Ollama、本地 mock 都可以实现这个接口。
 */
export interface LlmProvider {
  /** Provider 名称，用于日志、调试、模型路由。 */
  name: string;
  /** 根据消息列表生成文本回复。 */
  generate(messages: LlmMessage[]): Promise<string>;
}
