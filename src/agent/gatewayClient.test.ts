import { describe, expect, it } from "vitest";
import { GatewayClient, GatewayClientError } from "./gatewayClient";

describe("GatewayClient", () => {
  it("uses only the product session token and maps a structured note response", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const fetchImplementation = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(
        JSON.stringify({
          proposal: {
            summary: "候选",
            notes: [{ start: 0, dur: 1, pitch: 60, vel: 90 }],
          },
        }),
        { status: 200, headers: { "X-Request-Id": "req_1" } },
      );
    }) as unknown as typeof fetch;
    const client = new GatewayClient(
      "https://gateway.example/",
      fetchImplementation,
    );

    await expect(
      client.generateNotes("product-session", {
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

    expect(requestedUrl).toBe("https://gateway.example/v1/generation/notes");
    expect(requestedInit?.headers).toMatchObject({
      Authorization: "Bearer product-session",
    });
    expect(String(requestedInit?.body)).not.toContain("OPENAI_API_KEY");
    expect(String(requestedInit?.body)).toContain('"provider":"gemini"');
  });

  it("surfaces a retryable gateway error without exposing raw responses", async () => {
    const fetchImplementation = (async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          error: {
            code: "daily_limit_reached",
            message: "今日生成次数已用完。",
          },
          requestId: "req_limit",
        }),
        { status: 429, headers: { "Retry-After": "60" } },
      )) as unknown as typeof fetch;
    const client = new GatewayClient(
      "https://gateway.example",
      fetchImplementation,
    );

    await expect(
      client.register("a@example.com", "a secure password"),
    ).rejects.toEqual(
      new GatewayClientError(
        "daily_limit_reached",
        "今日生成次数已用完。",
        429,
        "req_limit",
        60,
      ),
    );
  });

  it("uses GET for the product-local usage ledger", async () => {
    let init: RequestInit | undefined;
    const fetchImplementation = (async (
      _input: string | URL | Request,
      requestInit?: RequestInit,
    ): Promise<Response> => {
      init = requestInit;
      return new Response(
        JSON.stringify({
          usage: {
            dailyUsed: 1,
            dailyLimit: 30,
            minuteUsed: 1,
            minuteLimit: 4,
          },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const client = new GatewayClient(
      "http://127.0.0.1:8787",
      fetchImplementation,
    );

    await expect(client.getUsage("product-session")).resolves.toMatchObject({
      dailyLimit: 30,
    });
    expect(init).toMatchObject({
      method: "GET",
      headers: { Authorization: "Bearer product-session" },
    });
  });
});
