// 上下文窗口

import type { Session, SessionMessage } from "../type/type";
/** 上下文窗口配置。 */
export interface ContextOptions {
  /** 进入 LLM 上下文的最近消息数量。 */
  maxMessages: number;
}

// 上下文管理器
export class ContextManager {
  constructor(private readonly options: ContextOptions) {}
  /**
   * 构建本次请求要注入 LLM 的上下文消息。
   * 策略：历史摘要 + pinned (重要消息)消息 + 最近 N 条普通消息。
   */
  buildContext(session: Session): SessionMessage[] {
    // pinned消息不参与滑动窗口裁剪，始终保留在上下文中
    const pinnedMessages = session.messages.filter((msg) => msg.pinned);
    // 获取最近的普通消息
    const recent = session.messages
      .filter((message) => !message.pinned)
      .slice(-this.options.maxMessages);

    //   如果已有历史摘要，则把摘要伪装成一条 system 消息放在最前面。
    const summaryMessage: SessionMessage[] = session.context.summary
      ? [
          {
            id: "summary",
            role: "system",
            content: `历史对话摘要：\n${session.context.summary}`,
            createdAt: session.updatedAt,
            agentName: "orchestrator",
            pinned: true,
          },
        ]
      : [];
    return [...summaryMessage, ...pinnedMessages, ...recent];
  }

  //   判断当前会话是否需要摘要压缩，这里简单处理
  shouldSummarize(session: Session): boolean {
    // 如果消息总数超过 maxMessages 的 3 倍，就认为需要摘要了
    return session.messages.length > this.options.maxMessages * 3;
  }
}
