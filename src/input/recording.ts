export const recordingGridBeats = 0.25;
export const recordedNoteVelocity = 100;

export interface CapturedKeyboardNote {
  midi: number;
  start: number;
  duration: number;
}

export interface QuantizedKeyboardNote {
  start: number;
  dur: number;
  pitch: number;
  vel: number;
}

export interface QuantizedRecordingResult {
  notes: QuantizedKeyboardNote[];
  droppedCount: number;
}

/**
 * 将短暂键盘事件转换为可写入工程的 1/16 音符。该函数不分配持久 ID，
 * 因此调用方可在提交 OperationBatch 时一次性创建 UUID。
 */
export function quantizeKeyboardRecording(
  captured: readonly CapturedKeyboardNote[],
  sectionBeats: number,
): QuantizedRecordingResult {
  const notes: QuantizedKeyboardNote[] = [];
  let droppedCount = 0;
  for (const item of captured) {
    if (
      !Number.isInteger(item.midi) ||
      item.midi < 0 ||
      item.midi > 127 ||
      !Number.isFinite(item.start) ||
      !Number.isFinite(item.duration) ||
      item.duration <= 0
    ) {
      droppedCount += 1;
      continue;
    }
    const start = quantizeBeat(Math.max(0, item.start));
    if (start >= sectionBeats) {
      droppedCount += 1;
      continue;
    }
    const requestedEnd = quantizeBeat(item.start + item.duration);
    const end = Math.min(
      sectionBeats,
      Math.max(start + recordingGridBeats, requestedEnd),
    );
    if (end <= start) {
      droppedCount += 1;
      continue;
    }
    notes.push({
      start,
      dur: end - start,
      pitch: item.midi,
      vel: recordedNoteVelocity,
    });
  }
  return {
    notes: notes.sort(
      (a, b) => a.start - b.start || a.pitch - b.pitch || a.dur - b.dur,
    ),
    droppedCount,
  };
}

export function recordingElapsedBeats(
  startedAtMs: number,
  nowMs: number,
  tempo: number,
): number {
  return Math.max(0, ((nowMs - startedAtMs) * tempo) / 60_000);
}

function quantizeBeat(value: number): number {
  return Math.round(value / recordingGridBeats) * recordingGridBeats;
}
