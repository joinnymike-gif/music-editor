import {
  compileM0PlaybackPlan,
  playbackPlanAudibilityIssue,
} from "../audio/playbackPlan";
import type { ProjectDocument } from "../doc/types";
import { resolveInstrument } from "../instruments/registry";

export const midiTicksPerBeat = 480;

/** 将当前可试听工程导出为 Standard MIDI File Type 1。 */
export function createMidiFile(document: ProjectDocument): Uint8Array {
  const planResult = compileM0PlaybackPlan(document);
  if (!planResult.ok)
    throw new Error(planResult.errors.map((error) => error.message).join("；"));
  const audibilityIssue = playbackPlanAudibilityIssue(planResult.plan);
  if (audibilityIssue) throw new Error(audibilityIssue);

  const melodicTracks = document.tracks.filter(
    (track) => track.role !== "drums",
  );
  if (melodicTracks.length > 15)
    throw new Error(
      "MIDI 最多支持 15 条同时使用独立 Program 的 melodic 轨道。",
    );

  const conductor = createConductorTrack(document.meta.tempo);
  const tracks = document.tracks.map((track) => {
    const instrument = resolveInstrument(
      document.meta.instrumentRegistryVersion,
      track.instrument,
    );
    if (!instrument)
      throw new Error(`找不到乐器 ${track.instrument}，无法导出 MIDI。`);
    const events = planResult.plan.events.filter(
      (event) => event.trackId === track.id,
    );
    const channel = midiChannelForTrack(document, track.id);
    return createInstrumentTrack({
      name: track.name,
      channel,
      program: instrument.midi.program,
      volume: track.vol,
      events,
    });
  });

  return concatBytes([
    ascii("MThd"),
    uint32(6),
    uint16(1),
    uint16(tracks.length + 1),
    uint16(midiTicksPerBeat),
    conductor,
    ...tracks,
  ]);
}

type TrackEvent = { tick: number; order: number; data: Uint8Array };

function createConductorTrack(tempo: number): Uint8Array {
  const microsecondsPerBeat = Math.round(60_000_000 / tempo);
  return chunkTrack([
    {
      tick: 0,
      order: 0,
      data: Uint8Array.from([
        0xff,
        0x51,
        0x03,
        (microsecondsPerBeat >> 16) & 0xff,
        (microsecondsPerBeat >> 8) & 0xff,
        microsecondsPerBeat & 0xff,
      ]),
    },
    {
      tick: 0,
      order: 1,
      // 4/4、每个 MIDI quarter note 24 clocks、每个 32nd note 8。
      data: Uint8Array.from([0xff, 0x58, 0x04, 4, 2, 24, 8]),
    },
  ]);
}

function createInstrumentTrack({
  name,
  channel,
  program,
  volume,
  events,
}: {
  name: string;
  channel: number;
  program?: number;
  volume: number;
  events: ReadonlyArray<{
    beat: number;
    dur: number;
    pitch: number;
    vel: number;
  }>;
}): Uint8Array {
  const bytes = new TextEncoder().encode(name);
  const trackEvents: TrackEvent[] = [
    {
      tick: 0,
      order: 0,
      data: concatBytes([
        Uint8Array.from([0xff, 0x03]),
        variableLength(bytes.length),
        bytes,
      ]),
    },
    {
      tick: 0,
      order: 1,
      data: Uint8Array.from([
        0xb0 | channel,
        7,
        Math.round(clamp(volume, 0, 1) * 127),
      ]),
    },
  ];
  if (program !== undefined)
    trackEvents.push({
      tick: 0,
      order: 2,
      data: Uint8Array.from([0xc0 | channel, program]),
    });
  events.forEach((event) => {
    const start = beatToTicks(event.beat);
    const end = beatToTicks(event.beat + event.dur);
    // 同一 tick 的 note-off 必须先于 note-on，避免重复音高被错误截断。
    trackEvents.push({
      tick: start,
      order: 4,
      data: Uint8Array.from([0x90 | channel, event.pitch, event.vel]),
    });
    trackEvents.push({
      tick: end,
      order: 3,
      data: Uint8Array.from([0x80 | channel, event.pitch, 0]),
    });
  });
  return chunkTrack(trackEvents);
}

function chunkTrack(events: TrackEvent[]): Uint8Array {
  const sorted = [...events].sort(
    (a, b) => a.tick - b.tick || a.order - b.order,
  );
  let previousTick = 0;
  const body: Uint8Array[] = [];
  for (const event of sorted) {
    body.push(variableLength(event.tick - previousTick), event.data);
    previousTick = event.tick;
  }
  body.push(Uint8Array.from([0x00, 0xff, 0x2f, 0x00]));
  const payload = concatBytes(body);
  return concatBytes([ascii("MTrk"), uint32(payload.length), payload]);
}

function midiChannelForTrack(
  document: ProjectDocument,
  trackId: string,
): number {
  const track = document.tracks.find((item) => item.id === trackId);
  if (!track) throw new Error("MIDI 轨道不存在。");
  if (track.role === "drums") return 9;
  const melodicIndex = document.tracks
    .filter((item) => item.role !== "drums")
    .findIndex((item) => item.id === trackId);
  return melodicIndex >= 9 ? melodicIndex + 1 : melodicIndex;
}

function beatToTicks(beat: number): number {
  return Math.max(0, Math.round(beat * midiTicksPerBeat));
}

function variableLength(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0)
    throw new Error("MIDI delta time 必须为非负整数。");
  const bytes = [value & 0x7f];
  let remaining = value >>> 7;
  while (remaining > 0) {
    bytes.unshift((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  return Uint8Array.from(bytes);
}

function uint16(value: number): Uint8Array {
  return Uint8Array.from([(value >>> 8) & 0xff, value & 0xff]);
}

function uint32(value: number): Uint8Array {
  return Uint8Array.from([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
