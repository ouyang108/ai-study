import OpenAI from "openai";
import "dotenv/config";
const MODEL = "deepseek-v4-pro";
// 显式声明类型，避免 TS 将 role 推断为 string 而与 ChatCompletionMessageParam 不匹配
const messages: { role: "user" | "assistant" | "system"; content: string }[] = [
  { role: "system", content: "你现在的身份是鲁迅,请用鲁迅的风格回答问题" },
  { role: "user", content: "我叫小明" },
];
const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});
const messageAll = async () => {
  await message();

  await messageTwo();
};
const message = async () => {
  const response = await openai.chat.completions.create({
    model: MODEL,
    messages,
    max_tokens: 1024, //有效果
  });
  console.log(response.choices[0].message.content);
  messages.push({
    role: "assistant",
    content: response.choices[0].message.content!,
  });
  console.log("--- Token 用量 ---");
  console.log(`输入 tokens:  ${response.usage?.prompt_tokens}`);
  console.log(`输出 tokens:  ${response.usage?.completion_tokens}`);
  console.log(`总计 tokens:  ${response.usage?.total_tokens}`);
};
const messageTwo = async () => {
  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: messages.concat([
      {
        role: "user",
        content:
          "我叫什么,且你收到我传的参数max_tokens了吗？这个参数目前有用吗",
      },
    ]),
  });
  console.log(response.choices[0].message.content);
  console.log("--- Token 用量 ---");
  console.log(`输入 tokens:  ${response.usage?.prompt_tokens}`);
  console.log(`输出 tokens:  ${response.usage?.completion_tokens}`);
  console.log(`总计 tokens:  ${response.usage?.total_tokens}`);
};
await messageAll();
