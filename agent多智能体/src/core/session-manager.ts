// 会话管理器 支持新建、列表、切换、删除、导出、恢复会话
// 目前用json文件存储会话数据
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { randomUUID } from "node:crypto";
import type { AgentName, Session, SessionMessage } from "../type/type";

// 会话管理器实例
export class SessionManager {
  constructor(private readonly sessionDir: string) {}

  async init() {
    // 确保会话目录存在 ，如果不存在则创建 如果已经存在则不做任何操作
    await mkdir(this.sessionDir, { recursive: true });
  }

  //   创建新会话
  async createSession(title: string, workingDir: string): Promise<Session> {
    // 先创建会话目录，如果不存在则创建
    await this.init();
    const nowTime = new Date().toISOString();
    const session: Session = {
      sessionId: randomUUID(),
      title,
      createdAt: nowTime,
      updatedAt: nowTime,
      messages: [],
      context: {
        workingDir,
        environment: {},
        customVars: {},
      },
    };
    await this.save(session);
    return session;
  }

  //   列出所有会话，按照更新时间排序
  async listSessions(): Promise<Session[]> {
    await this.init();
    const files = await readdir(this.sessionDir);
    const sessions: Session[] = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map((file) => this.load(file.replace(".json", ""))),
    );
    return sessions.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  //   加载会话数据
  async load(sessionId: string): Promise<Session> {
    const file = join(this.sessionDir, `${sessionId}.json`);
    return JSON.parse(await readFile(file, "utf8")) as Session;
  }

  //  保存会话数据到文件
  async save(session: Session) {
    await this.init();
    // 每次保存都要重新更新更新时间
    session.updatedAt = new Date().toISOString();
    const file = join(this.sessionDir, `${session.sessionId}.json`);
    await writeFile(file, JSON.stringify(session, null, 2), "utf8");
  }
  //   删除会话
  async delete(sessionId: string) {
    const file = join(this.sessionDir, `${sessionId}.json`);
    await rm(file);
  }

  //   追加消息
  async appendMessage(
    sessionId: string,
    input: Omit<SessionMessage, "id" | "createdAt">,
  ) {
    const session = await this.load(sessionId);
    const message = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...input,
    };
    session.messages.push(message);
    await this.save(session);
    return message;
  }
}
