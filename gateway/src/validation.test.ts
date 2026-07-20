import { describe, expect, it } from "vitest";
import {
  validateGenerateNotesRequest,
  validateModelProposal,
} from "./validation.js";

const scope = {
  trackId: "track_1",
  sectionId: "section_1",
  sectionBeats: 16,
  role: "lead",
  tempo: 120,
  key: "C",
  mode: "major",
};

describe("generation request validation", () => {
  it("accepts only a bounded selected-scope projection", () => {
    expect(
      validateGenerateNotesRequest(
        {
          prompt: "写一条明亮的旋律",
          provider: "gemini",
          strategy: "overdub",
          scope,
          contextNotes: [{ start: 0, dur: 1, pitch: 60, vel: 90 }],
        },
        1_600,
      ),
    ).toMatchObject({
      provider: "gemini",
      strategy: "overdub",
      scope,
      contextNotes: [{ pitch: 60 }],
    });
  });

  it("rejects notes outside the selected section and invalid model output", () => {
    expect(() =>
      validateGenerateNotesRequest(
        {
          prompt: "写一条旋律",
          provider: "untrusted-provider",
          strategy: "replace",
          scope,
          contextNotes: [],
        },
        1_600,
      ),
    ).toThrow("provider");
    expect(() =>
      validateGenerateNotesRequest(
        {
          prompt: "写一条旋律",
          strategy: "replace",
          scope,
          contextNotes: [{ start: 15.5, dur: 1, pitch: 60, vel: 90 }],
        },
        1_600,
      ),
    ).toThrow("超出当前 section 范围");
    expect(() =>
      validateModelProposal(
        { summary: "候选", notes: [{ start: 0, dur: 1, pitch: 128, vel: 90 }] },
        16,
      ),
    ).toThrow("pitch");
  });
});
