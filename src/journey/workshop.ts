import { currentInstrumentRegistryVersion } from "../instruments/registry";
import { assertValidProjectDocument } from "../doc/schema";
import type { Clip, Note, ProjectDocument, Track } from "../doc/types";
import type { OperationBatch } from "../ops/types";
import type {
  CreativeBrief,
  JourneyLength,
  JourneyMood,
  SongPlanStep,
} from "./types";

const workshopSections = [
  { name: "你的 10 秒旋律" },
  { name: "展开" },
  { name: "变化" },
  { name: "高潮" },
  { name: "收束" },
] as const;

const barsByLength: Record<JourneyLength, readonly number[]> = {
  "30s": [5, 4, 3, 2, 1],
  "60s": [5, 8, 8, 8, 1],
  "120s": [5, 16, 16, 16, 7],
};

export function createTenSecondWorkshopProject(
  mood: JourneyMood,
  now = new Date(),
  createId: () => string = () => crypto.randomUUID(),
): ProjectDocument {
  const createdAt = now.toISOString();
  const sections = workshopSections.map((section, index) => ({
    id: createId(),
    ...section,
    bars: barsByLength["60s"][index]!,
  }));
  const tracks: Track[] = [
    makeTrack(createId, "节奏钢琴", "harmony", "acoustic_piano", 0.66),
    makeTrack(createId, "低音", "bass", "finger_bass", 0.72),
    makeTrack(createId, "你的旋律", "lead", "violin", 0.62),
  ];
  const seed = sections[0]!;
  const clips: Clip[] = tracks.map((track) => ({
    id: createId(),
    trackId: track.id,
    sectionId: seed.id,
    notes: seedNotes(track.role, mood, createId),
  }));
  return assertValidProjectDocument({
    schemaVersion: "1.0",
    id: createId(),
    name: "我的第一首歌",
    createdAt,
    updatedAt: createdAt,
    meta: {
      tempo: 120,
      key: "C",
      mode: mood === "powerful" ? "minor" : "major",
      timeSig: [4, 4],
      instrumentRegistryVersion: currentInstrumentRegistryVersion,
    },
    sections,
    tracks,
    clips,
    automation: [],
  });
}

/**
 * Applies the duration selected in the journey before expansion begins. The
 * seed always remains ten seconds; only the subsequent editable sections are
 * resized, so playback, MIDI and WAV share one concrete arrangement length.
 */
export function buildWorkshopLengthAdjustment(
  project: ProjectDocument,
  length: JourneyLength,
): OperationBatch | null {
  const targetBars = barsByLength[length];
  const operations = project.sections.flatMap((section, index) => {
    const bars = targetBars[index];
    if (!bars || section.bars === bars) return [];
    return [
      {
        id: crypto.randomUUID(),
        type:
          bars > section.bars
            ? ("extendSection" as const)
            : ("shrinkSection" as const),
        scope: { kind: "section" as const, sectionId: section.id },
        args:
          bars > section.bars ? { bars } : { bars, overflow: "trim" as const },
      },
    ];
  });
  if (operations.length === 0) return null;
  return {
    id: crypto.randomUUID(),
    source: "macro",
    label: `设置成品长度：${length}`,
    operations,
  };
}

export function workshopLengthSeconds(length: JourneyLength): number {
  return { "30s": 30, "60s": 60, "120s": 120 }[length];
}

export function createSongPlan(project: ProjectDocument): SongPlanStep[] {
  return project.sections.map((section, index) => ({
    id: section.id,
    sectionName: section.name,
    energyLevel: ([1, 2, 3, 5, 1][index] ?? 3) as SongPlanStep["energyLevel"],
    description:
      index === 0
        ? "保留你刚做出的 10 秒旋律，作为整首歌的开场。"
        : index === 1
          ? "加入更稳定的鼓点和低音，让音乐向前走。"
          : index === 2
            ? "让旋律换一种说法，给耳朵一点新鲜感。"
            : index === 3
              ? "声音变得更丰富，但仍保留你的旋律线索。"
              : "回到最初的感觉，安静地结束。",
  }));
}

/** A no-network fallback. It writes only the requested, non-seed section. */
export function buildLocalSectionExtension(
  project: ProjectDocument,
  sectionId: string,
  brief: CreativeBrief,
): OperationBatch | null {
  const createId = () => crypto.randomUUID();
  const section = project.sections.find((item) => item.id === sectionId);
  if (!section || section.name === "你的 10 秒旋律") return null;
  const operations = project.tracks
    .filter(
      (track) =>
        !project.clips.some(
          (clip) => clip.trackId === track.id && clip.sectionId === section.id,
        ),
    )
    .map((track) => ({
      id: createId(),
      type: "upsertClip" as const,
      scope: {
        kind: "clip" as const,
        trackId: track.id,
        sectionId: section.id,
      },
      args: {
        clipId: createId(),
        notes: extensionNotes(track.role, section.bars * 4, brief, createId),
      },
    }));
  if (operations.length === 0) return null;
  return {
    id: createId(),
    source: "macro",
    label: `引导扩展：${section.name}`,
    operations,
  };
}

export function buildJourneyAiPrompt(
  project: ProjectDocument,
  sectionId: string,
  brief: CreativeBrief,
): string {
  const seed = project.sections[0];
  const references = brief.audioSeeds
    .map(
      (item) =>
        `${purposeLabel(item.purpose)}：${item.analysis.summary}（权重 ${item.weight}/5）`,
    )
    .join("；");
  return [
    `继续《${project.name}》的“${project.sections.find((item) => item.id === sectionId)?.name ?? "下一段"}”。`,
    `必须保留“${seed?.name ?? "你的 10 秒旋律"}”原样，不要修改该段。`,
    `感觉：${moodLabel(brief.mood)}；风格：${styleLabel(brief.style)}；发展：${energyLabel(brief.energy)}；原旋律：${motifLabel(brief.motifPolicy)}。`,
    references
      ? `以下是用户确认过的本机参考摘要，不能复制其中的旋律、歌词或音频：${references}。`
      : "没有外部音频参考，请以用户原创 10 秒旋律为主要依据。",
    brief.userCorrection.trim()
      ? `用户额外说明：${brief.userCorrection.trim()}。`
      : "",
    "只为当前选定轨道和段落生成可编辑 MIDI 音符；用自然、原创的变化回应以上方向。",
  ]
    .filter(Boolean)
    .join("\n");
}

function makeTrack(
  createId: () => string,
  name: string,
  role: Track["role"],
  instrument: string,
  vol: number,
): Track {
  return {
    id: createId(),
    name,
    role,
    instrument,
    vol,
    mute: false,
    solo: false,
  };
}

function seedNotes(
  role: Track["role"],
  mood: JourneyMood,
  createId: () => string,
): Note[] {
  if (role === "drums")
    return Array.from({ length: 20 }, (_, index) => ({
      id: createId(),
      start: index,
      dur: 0.25,
      pitch: index % 4 === 0 ? 36 : 42,
      vel: index % 4 === 0 ? 112 : 74,
    }));
  if (role === "bass")
    return Array.from({ length: 5 }, (_, index) => ({
      id: createId(),
      start: index * 4,
      dur: 3.5,
      pitch: mood === "powerful" ? 36 : 40,
      vel: 88,
    }));
  const pattern =
    mood === "bright"
      ? [60, 64, 67, 64, 72]
      : mood === "powerful"
        ? [60, 63, 67, 70, 67]
        : [60, 62, 67, 65, 64];
  return pattern.map((pitch, index) => ({
    id: createId(),
    start: index * 4,
    dur: 1.5,
    pitch,
    vel: 96,
  }));
}

function extensionNotes(
  role: Track["role"],
  beats: number,
  brief: CreativeBrief,
  createId: () => string,
): Note[] {
  if (role === "drums")
    return Array.from({ length: Math.floor(beats) }, (_, index) => ({
      id: createId(),
      start: index,
      dur: 0.2,
      pitch: index % 4 === 0 ? 36 : index % 2 === 0 ? 38 : 42,
      vel: brief.energy === "build" && index % 4 === 3 ? 100 : 78,
    }));
  if (role === "bass")
    return Array.from({ length: Math.ceil(beats / 4) }, (_, index) => ({
      id: createId(),
      start: index * 4,
      dur: 3.5,
      pitch: brief.style === "electronic" ? 36 : 40,
      vel: 86,
    }));
  const pitches =
    brief.mood === "powerful"
      ? [60, 63, 67, 70]
      : brief.mood === "bright"
        ? [60, 64, 67, 72]
        : [60, 62, 67, 65];
  return Array.from({ length: Math.ceil(beats / 2) }, (_, index) => ({
    id: createId(),
    start: index * 2,
    dur: 1,
    pitch: pitches[index % pitches.length]!,
    vel: 86,
  }));
}

function purposeLabel(
  value: CreativeBrief["audioSeeds"][number]["purpose"],
): string {
  return {
    mood: "整体感觉",
    rhythm: "节奏感觉",
    timbre: "声音感觉",
    structure: "结构感觉",
  }[value];
}
function moodLabel(value: JourneyMood): string {
  return { relaxed: "放松", bright: "轻快", powerful: "有力量" }[value];
}
function styleLabel(value: CreativeBrief["style"]): string {
  return { lofi: "Lo-fi", pop: "流行", electronic: "电子", game: "游戏配乐" }[
    value
  ];
}
function energyLabel(value: CreativeBrief["energy"]): string {
  return { steady: "保持平稳", build: "越来越热闹", contrast: "中间变化一下" }[
    value
  ];
}
function motifLabel(value: CreativeBrief["motifPolicy"]): string {
  return {
    featured: "始终是主角",
    occasional: "偶尔出现",
    "intro-only": "只当开场",
  }[value];
}
