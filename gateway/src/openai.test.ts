import { describe, expect, it, vi } from "vitest";
import { createResponsePayload, OpenAiResponsesClient } from "./openai.js";
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

describe("OpenAiResponsesClient", () => {
  it("uses the Responses API structured-output request without storage", () => {
    const payload = createResponsePayload(request, {
      model: "model-test",
      maxOutputTokens: 800,
    });
    expect(payload).toMatchObject({
      model: "model-test",
      store: false,
      max_output_tokens: 800,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(JSON.stringify(payload)).not.toContain("composer@example.com");
  });

  it("validates structured output and does not leak the API key in the payload", async () => {
    const fetchImplementation = vi.fn(
      async (): Promise<Response> =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              summary: "上行 C 大调动机",
              notes: [{ start: 0, dur: 1, pitch: 60, vel: 90 }],
            }),
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const client = new OpenAiResponsesClient({
      apiKey: "server-secret-only",
      model: "model-test",
      timeoutMs: 1_000,
      maxOutputTokens: 800,
      fetchImplementation,
    });

    await expect(client.generate(request)).resolves.toMatchObject({
      notes: [{ pitch: 60 }],
    });
    const init = fetchImplementation.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.body)).not.toContain("server-secret-only");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer server-secret-only",
    });
  });

  it("maps a structured-output refusal to an actionable local error", async () => {
    const client = new OpenAiResponsesClient({
      apiKey: "server-secret-only",
      model: "model-test",
      timeoutMs: 1_000,
      maxOutputTokens: 800,
      fetchImplementation: (async () =>
        new Response(
          JSON.stringify({
            output: [
              {
                type: "message",
                content: [{ type: "refusal", refusal: "Cannot produce that." }],
              },
            ],
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
    });

    await expect(client.generate(request)).rejects.toMatchObject({
      status: 422,
      code: "model_refused",
    });
  });
});
