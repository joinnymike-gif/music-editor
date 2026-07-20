import { validateProjectDocument } from "./schema";
import type { ProjectDocument, SchemaIssue } from "./types";

export type DocumentOpenResult =
  | { kind: "editable"; document: ProjectDocument; migratedFrom?: string }
  | {
      kind: "read_only_diagnostic";
      raw: unknown;
      sourceVersion: string | undefined;
      errors: SchemaIssue[];
      recovery: "export_raw_backup";
    };

type Migration = (document: Record<string, unknown>) => Record<string, unknown>;

// 新版本只可追加纯函数迁移；当前不存在历史版本，因此表为空但打开入口已固定。
const migrations: Readonly<Record<string, Migration>> = {};

export function openProjectDocument(raw: unknown): DocumentOpenResult {
  const sourceVersion = readSchemaVersion(raw);
  if (sourceVersion === "1.0") {
    const result = validateProjectDocument(raw);
    return result.valid
      ? { kind: "editable", document: result.document }
      : {
          kind: "read_only_diagnostic",
          raw,
          sourceVersion,
          errors: result.errors,
          recovery: "export_raw_backup",
        };
  }

  if (sourceVersion && migrations[sourceVersion] && isRecord(raw)) {
    const migrated = migrations[sourceVersion]({ ...raw });
    const result = validateProjectDocument(migrated);
    return result.valid
      ? {
          kind: "editable",
          document: result.document,
          migratedFrom: sourceVersion,
        }
      : {
          kind: "read_only_diagnostic",
          raw,
          sourceVersion,
          errors: result.errors,
          recovery: "export_raw_backup",
        };
  }

  return {
    kind: "read_only_diagnostic",
    raw,
    sourceVersion,
    errors: [
      {
        path: "$.schemaVersion",
        code: "unsupported_version",
        message: sourceVersion
          ? `不支持工程版本 ${sourceVersion}，已以只读诊断方式打开。`
          : "工程缺少可识别的 schemaVersion，已以只读诊断方式打开。",
      },
    ],
    recovery: "export_raw_backup",
  };
}

function readSchemaVersion(value: unknown): string | undefined {
  return isRecord(value) && typeof value.schemaVersion === "string"
    ? value.schemaVersion
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
