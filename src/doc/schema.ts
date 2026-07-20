import {
  schemaVersion,
  type AutomationParam,
  type ProjectDocument,
  type ProjectKey,
  type ProjectValidationResult,
  type SchemaIssue,
  type TrackRole,
} from "./types";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keys = new Set<ProjectKey>([
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
]);
const roles = new Set<TrackRole>([
  "drums",
  "bass",
  "harmony",
  "lead",
  "pad",
  "fx",
]);
const automationParams = new Set<AutomationParam>(["volume", "filterCutoff"]);

type RecordValue = Record<string, unknown>;

export function validateProjectDocument(
  value: unknown,
): ProjectValidationResult {
  const errors: SchemaIssue[] = [];
  const issue = (path: string, code: string, message: string) =>
    errors.push({ path, code, message });
  if (!isRecord(value))
    return {
      valid: false,
      errors: [{ path: "$", code: "type", message: "工程必须是 JSON 对象。" }],
    };

  const document = value;
  if (document.schemaVersion !== schemaVersion)
    issue(
      "$.schemaVersion",
      "schema_version",
      `仅支持 schemaVersion ${schemaVersion}。`,
    );
  requireUuid(document.id, "$.id", issue);
  requireString(document.name, "$.name", issue, 1, 100, true);
  requireUtcIso(document.createdAt, "$.createdAt", issue);
  requireUtcIso(document.updatedAt, "$.updatedAt", issue);

  validateMeta(document.meta, issue);
  const sections = requireArray(document.sections, "$.sections", issue);
  const tracks = requireArray(document.tracks, "$.tracks", issue);
  const clips = requireArray(document.clips, "$.clips", issue);
  const automation = requireArray(document.automation, "$.automation", issue);

  const sectionIds = new Set<string>();
  const trackIds = new Set<string>();
  const persistentIds = new Set<string>();
  let projectBeats = 0;

  if (sections) {
    if (sections.length === 0)
      issue("$.sections", "min_items", "工程至少需要一个 section。");
    sections.forEach((section, index) => {
      const path = `$.sections[${index}]`;
      if (!isRecord(section))
        return issue(path, "type", "section 必须是对象。");
      const id = requireUuid(section.id, `${path}.id`, issue);
      if (id) {
        addUniqueId(id, `${path}.id`, persistentIds, issue);
        if (sectionIds.has(id))
          issue(`${path}.id`, "duplicate", "section ID 必须唯一。");
        sectionIds.add(id);
      }
      requireString(section.name, `${path}.name`, issue, 1, 100, true);
      if (isIntegerInRange(section.bars, 1, 64))
        projectBeats += section.bars * 4;
      else issue(`${path}.bars`, "range", "bars 必须是 1–64 的整数。");
    });
  }

  if (tracks) {
    if (tracks.length === 0)
      issue("$.tracks", "min_items", "工程至少需要一条轨道。");
    tracks.forEach((track, index) => {
      const path = `$.tracks[${index}]`;
      if (!isRecord(track)) return issue(path, "type", "track 必须是对象。");
      const id = requireUuid(track.id, `${path}.id`, issue);
      if (id) {
        addUniqueId(id, `${path}.id`, persistentIds, issue);
        if (trackIds.has(id))
          issue(`${path}.id`, "duplicate", "track ID 必须唯一。");
        trackIds.add(id);
      }
      requireString(track.name, `${path}.name`, issue, 1, 100, true);
      if (typeof track.role !== "string" || !roles.has(track.role as TrackRole))
        issue(`${path}.role`, "enum", "role 必须是受支持的轨道角色。");
      requireString(
        track.instrument,
        `${path}.instrument`,
        issue,
        1,
        100,
        true,
      );
      if (!isNumberInRange(track.vol, 0, 1))
        issue(`${path}.vol`, "range", "vol 必须在 0–1。");
      if (typeof track.mute !== "boolean")
        issue(`${path}.mute`, "type", "mute 必须是布尔值。");
      if (typeof track.solo !== "boolean")
        issue(`${path}.solo`, "type", "solo 必须是布尔值。");
    });
  }

  if (clips) {
    const clipKeys = new Set<string>();
    clips.forEach((clip, index) => {
      const path = `$.clips[${index}]`;
      if (!isRecord(clip)) return issue(path, "type", "clip 必须是对象。");
      const id = requireUuid(clip.id, `${path}.id`, issue);
      if (id) addUniqueId(id, `${path}.id`, persistentIds, issue);
      const trackId =
        typeof clip.trackId === "string" ? clip.trackId : undefined;
      const sectionId =
        typeof clip.sectionId === "string" ? clip.sectionId : undefined;
      if (!trackId || !trackIds.has(trackId))
        issue(`${path}.trackId`, "reference", "clip 必须引用现有 track。");
      if (!sectionId || !sectionIds.has(sectionId))
        issue(`${path}.sectionId`, "reference", "clip 必须引用现有 section。");
      if (trackId && sectionId) {
        const clipKey = `${trackId}:${sectionId}`;
        if (clipKeys.has(clipKey))
          issue(path, "duplicate", "每个 track/section 组合最多一个 clip。");
        clipKeys.add(clipKey);
      }
      const notes = requireArray(clip.notes, `${path}.notes`, issue);
      const section =
        sectionId &&
        sections?.find((item) => isRecord(item) && item.id === sectionId);
      const sectionBeats =
        section && isRecord(section) && isIntegerInRange(section.bars, 1, 64)
          ? section.bars * 4
          : undefined;
      if (notes)
        validateNotes(
          notes,
          `${path}.notes`,
          sectionBeats,
          persistentIds,
          issue,
        );
    });
  }

  if (automation) validateAutomation(automation, trackIds, projectBeats, issue);
  return errors.length === 0
    ? { valid: true, document: value as unknown as ProjectDocument }
    : { valid: false, errors };
}

export function assertValidProjectDocument(value: unknown): ProjectDocument {
  const result = validateProjectDocument(value);
  if (result.valid) return result.document;
  throw new Error(
    `工程校验失败：${result.errors.map((error) => `${error.path}: ${error.message}`).join("；")}`,
  );
}

function validateMeta(value: unknown, issue: IssueReporter): void {
  if (!isRecord(value)) return issue("$.meta", "type", "meta 必须是对象。");
  if (!isNumberInRange(value.tempo, 40, 240))
    issue("$.meta.tempo", "range", "tempo 必须在 40–240 BPM。");
  if (typeof value.key !== "string" || !keys.has(value.key as ProjectKey))
    issue("$.meta.key", "enum", "key 必须是 12 个半音名之一。");
  if (value.mode !== "major" && value.mode !== "minor")
    issue("$.meta.mode", "enum", "mode 必须是 major 或 minor。");
  if (
    !Array.isArray(value.timeSig) ||
    value.timeSig.length !== 2 ||
    value.timeSig[0] !== 4 ||
    value.timeSig[1] !== 4
  )
    issue("$.meta.timeSig", "const", "v1 仅支持 timeSig [4, 4]。");
  requireString(
    value.instrumentRegistryVersion,
    "$.meta.instrumentRegistryVersion",
    issue,
    1,
    100,
    true,
  );
}

function validateNotes(
  notes: unknown[],
  path: string,
  sectionBeats: number | undefined,
  persistentIds: Set<string>,
  issue: IssueReporter,
): void {
  let previous: [number, number, number] | undefined;
  notes.forEach((note, index) => {
    const notePath = `${path}[${index}]`;
    if (!isRecord(note)) return issue(notePath, "type", "note 必须是对象。");
    const id = requireUuid(note.id, `${notePath}.id`, issue);
    if (id) addUniqueId(id, `${notePath}.id`, persistentIds, issue);
    const start = note.start;
    const duration = note.dur;
    const validStart = isFiniteNumber(start) && start >= 0;
    if (!validStart)
      issue(`${notePath}.start`, "range", "start 必须大于等于 0。");
    const validDuration = isFiniteNumber(duration) && duration > 0;
    if (!validDuration) issue(`${notePath}.dur`, "range", "dur 必须大于 0。");
    if (!isIntegerInRange(note.pitch, 0, 127))
      issue(`${notePath}.pitch`, "range", "pitch 必须是 0–127 的整数。");
    if (!isIntegerInRange(note.vel, 1, 127))
      issue(`${notePath}.vel`, "range", "vel 必须是 1–127 的整数。");
    if (
      isFiniteNumber(start) &&
      start >= 0 &&
      isFiniteNumber(duration) &&
      duration > 0 &&
      sectionBeats !== undefined &&
      start + duration > sectionBeats
    )
      issue(notePath, "section_boundary", "note 不能超出所在 section。");
    if (validStart && isIntegerInRange(note.pitch, 0, 127) && validDuration) {
      const current: [number, number, number] = [start, note.pitch, duration];
      if (previous && compareNoteOrder(previous, current) > 0)
        issue(
          notePath,
          "sort_order",
          "notes 必须按 start、pitch、dur 稳定排序。",
        );
      previous = current;
    }
  });
}

function validateAutomation(
  lanes: unknown[],
  trackIds: Set<string>,
  projectBeats: number,
  issue: IssueReporter,
): void {
  const laneKeys = new Set<string>();
  lanes.forEach((lane, index) => {
    const path = `$.automation[${index}]`;
    if (!isRecord(lane))
      return issue(path, "type", "automation lane 必须是对象。");
    const trackId = typeof lane.trackId === "string" ? lane.trackId : undefined;
    if (!trackId || !trackIds.has(trackId))
      issue(`${path}.trackId`, "reference", "automation 必须引用现有 track。");
    if (
      typeof lane.param !== "string" ||
      !automationParams.has(lane.param as AutomationParam)
    )
      issue(`${path}.param`, "enum", "automation param 必须受支持。");
    if (trackId && typeof lane.param === "string") {
      const laneKey = `${trackId}:${lane.param}`;
      if (laneKeys.has(laneKey))
        issue(path, "duplicate", "同一 track/param 最多一个 lane。");
      laneKeys.add(laneKey);
    }
    const points = requireArray(lane.points, `${path}.points`, issue);
    if (!points) return;
    let previousAt = -1;
    points.forEach((point, pointIndex) => {
      const pointPath = `${path}.points[${pointIndex}]`;
      if (!isRecord(point))
        return issue(pointPath, "type", "automation point 必须是对象。");
      if (!isFiniteNumber(point.at) || point.at < 0 || point.at > projectBeats)
        issue(`${pointPath}.at`, "range", "at 必须在工程全局 beat 范围内。");
      else if (point.at <= previousAt)
        issue(
          `${pointPath}.at`,
          "sort_order",
          "automation points 必须按 at 严格递增。",
        );
      else previousAt = point.at;
      if (!isNumberInRange(point.val, 0, 1))
        issue(`${pointPath}.val`, "range", "automation 值必须在 0–1。");
    });
  });
}

type IssueReporter = (path: string, code: string, message: string) => void;

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
  trim: boolean,
): void {
  if (
    typeof value !== "string" ||
    value.length < min ||
    value.length > max ||
    (trim && value.trim().length === 0)
  )
    issue(path, "string", `必须是 ${min}–${max} 个非空字符。`);
}
function requireUtcIso(
  value: unknown,
  path: string,
  issue: IssueReporter,
): void {
  if (
    typeof value !== "string" ||
    !value.endsWith("Z") ||
    Number.isNaN(Date.parse(value))
  )
    issue(path, "datetime", "必须是 ISO-8601 UTC 时间。");
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function isNumberInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return isFiniteNumber(value) && value >= min && value <= max;
}
function isIntegerInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return Number.isInteger(value) && isNumberInRange(value, min, max);
}
function addUniqueId(
  id: string,
  path: string,
  ids: Set<string>,
  issue: IssueReporter,
): void {
  if (ids.has(id)) issue(path, "duplicate", "工程内持久 ID 必须全局唯一。");
  ids.add(id);
}
function compareNoteOrder(
  a: [number, number, number],
  b: [number, number, number],
): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
