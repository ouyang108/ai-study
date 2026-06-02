// 记录有副作用工具调用的撤销信息，支持 `/undo`。
import type { ToolCall, ToolResult, UndoInfo } from "../type/type";
import type { ToolRegistry } from "../tools/tool-registry";
/** 单条工具操作历史记录。 */
export interface OperationRecord {
  /** 操作记录唯一 ID。 */
  id: string;
  /** 原始工具调用。 */
  toolCall: ToolCall;
  /** 原始工具执行结果。 */
  result: ToolResult;
  /** 可选撤销信息，没有 undoInfo 的操作不可撤销。 */
  undoInfo?: UndoInfo;
  /** 操作发生时间。 */
  createdAt: string;
}
// 撤销管理器
export class UndoManager {
  private readonly history: OperationRecord[] = [];
  /** 重做栈，MVP 中先保留结构，后续实现 redo。 */
  private readonly redoStack: OperationRecord[] = [];

  /** 记录一次工具操作。只有带 undoInfo 的操作会进入历史栈。 */
  record(record: OperationRecord): void {
    if (record.undoInfo) {
      this.history.push(record);
      // 新操作发生后，redo 历史应清空。
      this.redoStack.length = 0;
    }
  }
  /** 返回当前可撤销操作历史的副本。 */
  list(): OperationRecord[] {
    return [...this.history];
  }
  //   撤销最近一次的操作
  async undoLast(toolReistry: ToolRegistry) {
    // 从历史栈弹出最近一次操作。
    const last = this.history.pop();
    if (!last?.undoInfo) {
      return { success: false, error: "No operation to undo" };
    }
    // MVP 先支持 reverse 类型撤销。
    if (last.undoInfo.action !== "reverse" || !last.undoInfo.reverseCall) {
      return { success: false, error: "Unsupported undo action" };
    }
    const result = await toolReistry.call(
      last.undoInfo.reverseCall.toolName,
      last.undoInfo.reverseCall.args,
    );
    // 撤销成功后放入 redo 栈，后续可以实现 redo。
    if (result.success) {
      this.redoStack.push(last);
    }

    return result;
  }
}
