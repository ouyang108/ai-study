// 消息总线
// 用于在不同智能体之间传递消息

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { AgentEvent, AgentName } from "../type/type";

// 消息总线实例 MVP
export class MessageBus {
  private emitter = new EventEmitter();
  // 发布事件
  publish(event: Omit<AgentEvent, "id" | "timestamp">) {
    const fullEvent: AgentEvent = {
      ...event,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    // 发布事件, 事件类型为 event,全局监听者可以监听这个事件类型来接收所有事件
    this.emitter.emit("event", fullEvent);
    // 发送到目标 Agent 专属通道。
    this.emitter.emit(event.toAgent, fullEvent);
    // 发送给来源 Agent 专属通道。
    this.emitter.emit(event.fromAgent, fullEvent);
    return fullEvent;
  }
  //   订阅事件
  subscribe(
    agentName: AgentName | "all",
    callback: (event: AgentEvent) => void,
  ) {
    // all 表示监听所有事件，否则监听指定 Agent 名称的通道。
    const channel = agentName === "all" ? "event" : agentName;
    this.emitter.on(channel, callback);
    return () => {
      this.emitter.off(channel, callback);
    };
  }
}
