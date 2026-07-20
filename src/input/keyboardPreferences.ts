export const keyboardOctaveStorageKey = "ai-music-ide.keyboard-octave";
export const defaultKeyboardOctave = 4;
export const minimumKeyboardOctave = 1;
export const maximumKeyboardOctave = 7;

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

export function loadKeyboardOctave(storage?: KeyValueStorage): number {
  const value = storage?.getItem(keyboardOctaveStorageKey);
  if (value === null || value === undefined) return defaultKeyboardOctave;
  const parsed = Number(value);
  return Number.isInteger(parsed) && isKeyboardOctaveInRange(parsed)
    ? parsed
    : defaultKeyboardOctave;
}

export function saveKeyboardOctave(
  octave: number,
  storage?: KeyValueStorage,
): void {
  storage?.setItem(
    keyboardOctaveStorageKey,
    String(clampKeyboardOctave(octave)),
  );
}

export function adjustKeyboardOctave(octave: number, amount: -1 | 1): number {
  return clampKeyboardOctave(octave + amount);
}

function isKeyboardOctaveInRange(octave: number): boolean {
  return octave >= minimumKeyboardOctave && octave <= maximumKeyboardOctave;
}

function clampKeyboardOctave(octave: number): number {
  if (!Number.isFinite(octave)) return defaultKeyboardOctave;
  return Math.min(
    maximumKeyboardOctave,
    Math.max(minimumKeyboardOctave, Math.round(octave)),
  );
}
