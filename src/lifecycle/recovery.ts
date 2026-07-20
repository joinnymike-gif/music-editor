import { assertValidProjectDocument } from "../doc/schema";
import type { ProjectDocument } from "../doc/types";

export const recoveryStorageKey = "ai-music-ide:recovery:v1";

export interface RecoverySnapshot {
  document: ProjectDocument;
  filePath: string | null;
  lastSavedAt: string | null;
  capturedAt: string;
}

export function saveRecoverySnapshot(
  snapshot: RecoverySnapshot,
  storage: Storage | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  try {
    storage.setItem(recoveryStorageKey, JSON.stringify(snapshot));
  } catch {
    // 本地存储不可用不应影响内存工程；界面仍可让用户显式保存 JSON。
  }
}

export function loadRecoverySnapshot(
  storage: Storage | undefined = globalThis.localStorage,
): RecoverySnapshot | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(recoveryStorageKey);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecoverySnapshot(value)) throw new Error("恢复副本格式无效。");
    return {
      document: assertValidProjectDocument(value.document),
      filePath: value.filePath,
      lastSavedAt: value.lastSavedAt,
      capturedAt: value.capturedAt,
    };
  } catch {
    discardRecoverySnapshot(storage);
    return null;
  }
}

export function discardRecoverySnapshot(
  storage: Storage | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  try {
    storage.removeItem(recoveryStorageKey);
  } catch {
    // 无需因清理失败阻断用户继续编辑。
  }
}

function isRecoverySnapshot(value: unknown): value is {
  document: unknown;
  filePath: string | null;
  lastSavedAt: string | null;
  capturedAt: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    "document" in record &&
    (typeof record.filePath === "string" || record.filePath === null) &&
    (typeof record.lastSavedAt === "string" || record.lastSavedAt === null) &&
    typeof record.capturedAt === "string"
  );
}
