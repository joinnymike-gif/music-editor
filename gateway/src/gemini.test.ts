import { describe, expect, it, vi } from "vitest";
import {
  createGeminiInteractionPayload,
  GeminiInteractionsClient,
} from "./gemini.js";
import type { ModelGenerationRequest } from "./types.js";

const request: ModelGenerationRequest = {
  account: { id: "account_1", email: "composer@example.com" },
  requestId: "request_1",
  request: {
    prompt: "做一条 C 大调旋律",
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
};

describe("GeminiInteractionsClient", () => {
  it("uses the Gemini structured-output interaction without storage", () => {
    const payload = createGeminiInteractionPayload(request, {
      model: "gemini-test",
      maxOutputTokens: 800,
    });
    expect(payload).toMatchObject({
      model: "gemini-test",
      store: false,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: { type: "object" },
      },
      generation_config: { max_output_tokens: 800 },
    });
    expect(JSON.stringify(payload)).not.toContain("composer@example.com");
  });

  it("parses a model-output step and sends the key only as a server-side header", async () => {
    const fetchImplementation = vi.fn(
      async (): Promise<Response> =>
        new Response(
          JSON.stringify({
            steps: [
              {
                type: "model_output",
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      summary: "上行 C 大调动机",
                      notes: [{ start: 0, dur: 1, pitch: 60, vel: 90 }],
                    }),
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const client = new GeminiInteractionsClient({
      apiKey: "server-secret-only",
      model: "gemini-test",
      timeoutMs: 1_000,
      maxOutputTokens: 800,
      fetchImplementation,
    });

    await expect(client.generate(request)).resolves.toMatchObject({
      notes: [{ pitch: 60 }],
    });
    const init = fetchImplementation.mock.calls[0]?.[1] as RequestInit;
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
    );
    expect(String(init.body)).not.toContain("server-secret-only");
    expect(init.headers).toMatchObject({
      "x-goog-api-key": "server-secret-only",
    });
  });

  it("rejects a response without structured text", async () => {
    const client = new GeminiInteractionsClient({
      apiKey: "server-secret-only",
      model: "gemini-test",
      timeoutMs: 1_000,
      maxOutputTokens: 800,
      fetchImplementation: (async () =>
        new Response(JSON.stringify({ steps: [] }), {
          status: 200,
        })) as unknown as typeof fetch,
    });

    await expect(client.generate(request)).rejects.toMatchObject({
      status: 502,
      code: "invalid_model_response",
    });
  });
});
