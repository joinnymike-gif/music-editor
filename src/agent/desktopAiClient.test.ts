import { describe, expect, it, vi } from "vitest";
import {
  DesktopAiClient,
  DesktopAiClientError,
  type DesktopAiInvoke,
} from "./desktopAiClient";

describe("DesktopAiClient", () => {
  it("uses native commands and never sends a key in a generation request", async () => {
    const rawInvoke = vi.fn(
      async (command: string, _args?: Record<string, unknown>) => {
        void _args;
        if (command === "get_desktop_ai_status") {
          return { providers: [{ provider: "gemini", configured: true }] };
        }
        return {
          provider: "gemini",
          proposal: {
            summary: "候选",
            notes: [{ start: 0, dur: 1, pitch: 60, vel: 90 }],
          },
        };
      },
    );
    const client = new DesktopAiClient(
      rawInvoke as unknown as DesktopAiInvoke,
      () => undefined,
    );

    await expect(client.getStatus()).resolves.toMatchObject({
      providers: [{ provider: "gemini", configured: true }],
    });
    await expect(
      client.generateNotes({
        provider: "gemini",
        prompt: "写一条旋律",
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
      }),
    ).resolves.toMatchObject({ notes: [{ pitch: 60 }] });

    const generationCall = rawInvoke.mock.calls.find(
      ([command]) => command === "generate_desktop_ai_notes",
    );
    expect(JSON.stringify(generationCall?.[1])).not.toContain("API_KEY");
  });

  it("maps native structured errors without exposing native implementation details", async () => {
    const client = new DesktopAiClient(
      (async () =>
        Promise.reject({
          code: "ai_not_configured",
          message: "尚未配置 Gemini API Key。",
        })) as DesktopAiInvoke,
      () => undefined,
    );

    await expect(client.getStatus()).rejects.toEqual(
      new DesktopAiClientError(
        "ai_not_configured",
        "尚未配置 Gemini API Key。",
      ),
    );
  });
});
