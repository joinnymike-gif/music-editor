import { describe, expect, it } from "vitest";
import {
  adjustKeyboardOctave,
  defaultKeyboardOctave,
  keyboardOctaveStorageKey,
  loadKeyboardOctave,
  maximumKeyboardOctave,
  minimumKeyboardOctave,
  saveKeyboardOctave,
} from "./keyboardPreferences";

function createStorage(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("电脑键盘八度偏好", () => {
  it("在没有或损坏的本地偏好时回退到 C4", () => {
    expect(loadKeyboardOctave()).toBe(defaultKeyboardOctave);
    expect(
      loadKeyboardOctave(createStorage({ [keyboardOctaveStorageKey]: "9" })),
    ).toBe(defaultKeyboardOctave);
  });

  it("只保存并限制 C1 到 C7 的默认八度", () => {
    const storage = createStorage();
    saveKeyboardOctave(12, storage);
    expect(loadKeyboardOctave(storage)).toBe(maximumKeyboardOctave);
    expect(adjustKeyboardOctave(minimumKeyboardOctave, -1)).toBe(
      minimumKeyboardOctave,
    );
    expect(adjustKeyboardOctave(maximumKeyboardOctave, 1)).toBe(
      maximumKeyboardOctave,
    );
  });

  it("反复升降八度后仍能回到有效的试听八度", () => {
    let octave = defaultKeyboardOctave;
    for (let index = 0; index < 12; index += 1) {
      octave = adjustKeyboardOctave(octave, -1);
    }
    for (let index = 0; index < 12; index += 1) {
      octave = adjustKeyboardOctave(octave, 1);
    }
    expect(octave).toBe(maximumKeyboardOctave);
  });
});
