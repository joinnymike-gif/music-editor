import { describe, expect, it } from "vitest";
import { LocalDemoModelClient } from "./localDemoModel.js";

describe("LocalDemoModelClient", () => {
  it("returns a deterministic in-range candidate without using an external provider", async () => {
    const client = new LocalDemoModelClient();
    const proposal = await client.generate({
      account: { id: "account_1", email: "demo@local.test" },
      requestId: "request_1",
      request: {
        prompt: "ignored by the local deterministic demo",
        strategy: "replace",
        scope: {
          trackId: "track_1",
          sectionId: "section_1",
          sectionBeats: 16,
          role: "lead",
          tempo: 120,
          key: "C",
          mode: "major",
        },
        contextNotes: [],
      },
    });

    expect(proposal.summary).toContain("本地演示候选");
    expect(proposal.notes).toHaveLength(8);
    expect(proposal.notes.every((note) => note.start + note.dur <= 16)).toBe(
      true,
    );
  });
});
