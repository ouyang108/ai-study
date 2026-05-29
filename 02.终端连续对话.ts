import OpenAI from "openai";
import "dotenv/config";
import * as readline from "readline";
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const MODEL = "deepseek-v4-pro";
// 显式声明类型，避免 TS 将 role 推断为 string 而与 ChatCompletionMessageParam 不匹配
const messages: { role: "user" | "assistant" | "system"; content: string }[] = [
  { role: "system", content: "你现在的身份是鲁迅,请用鲁迅的风格回答问题" },
];
const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});
// 调用 API，获取回复
const getResponse = async () => {
  // 加一个终端等待动画
  console.log("思考中...");
  const response = await openai.chat.completions.create({
    model: MODEL,
    messages,
  });
  return response.choices[0].message.content;
};

function askQuestion() {
  rl.question("你: ", async (input) => {
    // 处理特殊命令
    if (input === "exit" || input === "quit") {
      console.log("再见！");
      rl.close();
      return;
    }
    if (input === "clear") {
      messages.length = 1; // 只保留 system prompt
      console.log("对话历史已清空");
      askQuestion();
      return;
    }

    // TODO: 把用户输入加入 history
    messages.push({
      role: "user",
      content: input,
    });
    // TODO: 调用 API，获取回复
    const response = await getResponse();
    // TODO: 把回复加入 history
    messages.push({
      role: "assistant",
      content: response!,
    });
    // TODO: 打印回复
    console.log(response!);
    // TODO: 再次调用 askQuestion() 等待下一轮输入
    askQuestion();
  });
}

console.log("开始对话！（输入 exit 退出，输入 clear 清空历史）\n");
askQuestion();
