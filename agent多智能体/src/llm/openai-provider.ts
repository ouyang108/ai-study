import OpenAI from "openai";

import type { LlmMessage, LlmProvider } from "./llm-provider";

export class OpenAIProvider implements LlmProvider {
  name = "openai";
  private client: OpenAI = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY!,
    baseURL: "https://api.deepseek.com",
  });
  constructor(private readonly model = "deepseek-v4-flash") {}

  //   调用接口
  async generate(messages: LlmMessage[]): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    });
    return response.choices[0].message.content!;
  }
}
