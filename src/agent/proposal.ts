import type { ProjectDocument } from "../doc/types";
import { applyOperationBatch } from "../ops/apply";
import type { OperationBatch } from "../ops/types";
import type {
  GatewayGenerationStrategy,
  GatewayNoteProposal,
} from "./gatewayClient";

export interface ProposalTarget {
  trackId: string;
  sectionId: string;
}

export interface LocalNoteProposal {
  summary: string;
  strategy: GatewayGenerationStrategy;
  target: ProposalTarget;
  noteCount: number;
  sourceDocumentFingerprint: string;
  batch: OperationBatch;
  simulatedDocument: ProjectDocument;
}

export type ProposalBuildResult =
  { ok: true; proposal: LocalNoteProposal } | { ok: false; message: string };

/**
 * Treats every gateway response as untrusted. A proposal has no write access
 * until the exact batch succeeds against an in-memory project copy.
 */
export function buildLocalNoteProposal(
  project: ProjectDocument,
  target: ProposalTarget,
  strategy: GatewayGenerationStrategy,
  remoteProposal: GatewayNoteProposal,
): ProposalBuildResult {
  if (
    typeof remoteProposal.summary !== "string" ||
    !remoteProposal.summary.trim() ||
    remoteProposal.summary.length > 300 ||
    !Array.isArray(remoteProposal.notes) ||
    remoteProposal.notes.length > 64
  ) {
    return { ok: false, message: "AI 返回的候选格式无效，未写入工程。" };
  }
  const track = project.tracks.find((item) => item.id === target.trackId);
  const section = project.sections.find((item) => item.id === target.sectionId);
  if (!track || !section) {
    return { ok: false, message: "生成范围已不存在，请重新选择轨道与段落。" };
  }
  const sectionBeats = section.bars * 4;
  const invalidIndex = remoteProposal.notes.findIndex((note) => {
    if (
      !Number.isFinite(note.start) ||
      !Number.isFinite(note.dur) ||
      !Number.isInteger(note.pitch) ||
      !Number.isInteger(note.vel) ||
      note.start < 0 ||
      note.dur < 0.0625 ||
      note.start + note.dur > sectionBeats + Number.EPSILON ||
      note.pitch < 0 ||
      note.pitch > 127 ||
      note.vel < 1 ||
      note.vel > 127
    ) {
      return true;
    }
  });
  if (invalidIndex >= 0) {
    return {
      ok: false,
      message: `候选的第 ${invalidIndex + 1} 个音符无效，未写入工程。`,
    };
  }
  const notes = remoteProposal.notes.map((note) => ({
    ...note,
    id: crypto.randomUUID(),
  }));
  const scope = { kind: "clip" as const, ...target };
  const clip = project.clips.find(
    (item) =>
      item.trackId === target.trackId && item.sectionId === target.sectionId,
  );
  const operation = !clip
    ? {
        id: crypto.randomUUID(),
        type: "upsertClip" as const,
        scope,
        args: { clipId: crypto.randomUUID(), notes },
      }
    : {
        id: crypto.randomUUID(),
        type:
          strategy === "replace"
            ? ("replaceClipNotes" as const)
            : ("insertNotes" as const),
        scope,
        args: { trackId: target.trackId, sectionId: target.sectionId, notes },
      };
  const batch: OperationBatch = {
    id: crypto.randomUUID(),
    source: "agent",
    // The human-facing proposal may contain up to 300 characters, while an
    // undoable OperationBatch label is intentionally capped at 120. Keep the
    // full summary for review and create a bounded audit label for the batch.
    label: operationLabelForProposal(remoteProposal.summary),
    operations: [operation],
  };
  const simulated = applyOperationBatch(project, batch);
  if (!simulated.applied) {
    return {
      ok: false,
      message: `候选未通过本地工程校验：${simulated.errors.map((error) => error.message).join("；")}`,
    };
  }
  return {
    ok: true,
    proposal: {
      summary: remoteProposal.summary,
      strategy,
      target,
      noteCount: notes.length,
      sourceDocumentFingerprint: projectFingerprint(project),
      batch,
      simulatedDocument: simulated.document,
    },
  };
}

const operationLabelPrefix = "AI 候选：";
const maxOperationLabelLength = 120;

function operationLabelForProposal(summary: string): string {
  const available = maxOperationLabelLength - operationLabelPrefix.length;
  const compact = summary.trim().replace(/\s+/g, " ");
  if (compact.length <= available) return `${operationLabelPrefix}${compact}`;
  let truncated = compact.slice(0, available - 1);
  // Do not leave an unpaired UTF-16 surrogate if an emoji falls on the edge.
  const last = truncated.charCodeAt(truncated.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) truncated = truncated.slice(0, -1);
  return `${operationLabelPrefix}${truncated.trimEnd()}…`;
}

/** Stable enough for a short-lived local Proposal; it is never sent to a server. */
export function projectFingerprint(project: ProjectDocument): string {
  return JSON.stringify(project);
}
