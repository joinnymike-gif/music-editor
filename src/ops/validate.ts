import type {
  OperationBatch,
  OperationIssue,
  OperationSource,
  OperationType,
  OperationValidationResult,
  Scope,
} from "./types";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const operationSources = new Set<OperationSource>([
  "manual",
  "keyboard",
  "agent",
  "macro",
  "import",
]);

const operationTypes = new Set<OperationType>([
  "addSection",
  "removeSection",
  "extendSection",
  "shrinkSection",
  "reorderSections",
  "addTrack",
  "removeTrack",
  "setInstrument",
  "upsertClip",
  "removeClip",
  "replaceClipNotes",
  "insertNotes",
  "updateNotes",
  "removeNotes",
  "removeNotesInRange",
  "transpose",
  "quantize",
  "setVelocity",
  "halfTime",
  "doubleTime",
  "humanize",
  "setTempo",
  "setKey",
  "changeKey",
  "setVolume",
  "mute",
  "solo",
  "upsertAutomationPoints",
  "removeAutomationPoints",
]);

type RecordValue = Record<string, unknown>;
type IssueReporter = (path: string, code: string, message: string) => void;

export function validateOperationBatch(
  value: unknown,
): OperationValidationResult {
  const errors: OperationIssue[] = [];
  const issue: IssueReporter = (path, code, message) =>
    errors.push({ path, code, message });
  if (!isRecord(value))
    return {
      valid: false,
      errors: [{ path: "$", code: "type", message: "操作批必须是对象。" }],
    };

  rejectUnknownKeys(value, ["id", "source", "label", "operations"], "$", issue);
  requireUuid(value.id, "$.id", issue);
  if (
    typeof value.source !== "string" ||
    !operationSources.has(value.source as OperationSource)
  )
    issue("$.source", "enum", "source 必须是受支持的操作来源。");
  requireString(value.label, "$.label", issue, 1, 120);
  const operations = requireArray(value.operations, "$.operations", issue);
  if (operations) {
    if (operations.length === 0)
      issue("$.operations", "min_items", "操作批至少包含一个操作。");
    const ids = new Set<string>();
    operations.forEach((operation, index) => {
      const path = `$.operations[${index}]`;
      const id = validateOperation(operation, path, issue);
      if (!id) return;
      if (ids.has(id))
        issue(`${path}.id`, "duplicate", "操作 ID 必须在批内唯一。");
      ids.add(id);
    });
  }

  return errors.length === 0
    ? { valid: true, batch: value as unknown as OperationBatch }
    : { valid: false, errors };
}

function validateOperation(
  value: unknown,
  path: string,
  issue: IssueReporter,
): string | undefined {
  if (!isRecord(value)) {
    issue(path, "type", "操作必须是对象。");
    return undefined;
  }
  rejectUnknownKeys(value, ["id", "type", "scope", "args"], path, issue);
  const id = requireUuid(value.id, `${path}.id`, issue);
  if (
    typeof value.type !== "string" ||
    !operationTypes.has(value.type as OperationType)
  )
    issue(`${path}.type`, "enum", "type 必须是受支持的原语。");
  validateScope(value.scope, `${path}.scope`, issue);
  if (!isRecord(value.args)) issue(`${path}.args`, "type", "args 必须是对象。");
  return id;
}

function validateScope(
  value: unknown,
  path: string,
  issue: IssueReporter,
): void {
  if (!isRecord(value)) return issue(path, "type", "scope 必须是对象。");
  if (value.kind === "whole") {
    rejectUnknownKeys(value, ["kind"], path, issue);
    return;
  }
  if (value.kind === "section") {
    rejectUnknownKeys(value, ["kind", "sectionId"], path, issue);
    requireUuid(value.sectionId, `${path}.sectionId`, issue);
    return;
  }
  if (value.kind === "track") {
    rejectUnknownKeys(value, ["kind", "trackId"], path, issue);
    requireUuid(value.trackId, `${path}.trackId`, issue);
    return;
  }
  if (value.kind === "clip") {
    rejectUnknownKeys(value, ["kind", "trackId", "sectionId"], path, issue);
    requireUuid(value.trackId, `${path}.trackId`, issue);
    requireUuid(value.sectionId, `${path}.sectionId`, issue);
    return;
  }
  issue(
    `${path}.kind`,
    "enum",
    "scope.kind 必须是 whole、section、track 或 clip。",
  );
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireArray(
  value: unknown,
  path: string,
  issue: IssueReporter,
): unknown[] | undefined {
  if (!Array.isArray(value)) {
    issue(path, "type", "必须是数组。");
    return undefined;
  }
  return value;
}

function requireUuid(
  value: unknown,
  path: string,
  issue: IssueReporter,
): string | undefined {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    issue(path, "uuid", "必须是 UUID。");
    return undefined;
  }
  return value;
}

function requireString(
  value: unknown,
  path: string,
  issue: IssueReporter,
  min: number,
  max: number,
): void {
  if (
    typeof value !== "string" ||
    value.length < min ||
    value.length > max ||
    value.trim().length === 0
  )
    issue(path, "string", `必须是 ${min}–${max} 个非空字符。`);
}

function rejectUnknownKeys(
  value: RecordValue,
  allowedKeys: string[],
  path: string,
  issue: IssueReporter,
): void {
  const allowed = new Set(allowedKeys);
  Object.keys(value).forEach((key) => {
    if (!allowed.has(key))
      issue(`${path}.${key}`, "unknown_key", "不允许未知字段。");
  });
}

export function isOperationBatch(value: unknown): value is OperationBatch {
  return validateOperationBatch(value).valid;
}

export function isScope(value: unknown): value is Scope {
  const errors: OperationIssue[] = [];
  validateScope(value, "$.scope", (path, code, message) =>
    errors.push({ path, code, message }),
  );
  return errors.length === 0;
}
