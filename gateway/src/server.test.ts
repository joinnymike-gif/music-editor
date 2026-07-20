import { describe, expect, it, vi } from "vitest";
import { createGatewayApi } from "./server.js";
import type { GatewayConfig, ModelClient } from "./types.js";

const config: GatewayConfig = {
  port: 8787,
  allowedOrigin: "http://localhost:1420",
  sessionSecret: "s".repeat(32),
  sessionTtlSeconds: 1_800,
  requestTimeoutMs: 30_000,
  requestsPerMinute: 2,
  dailyGenerationLimit: 4,
  maxPromptChars: 1_600,
  maxOutputTokens: 800,
  modelProvider: "openai",
  openAiModel: "openai-model-test",
  geminiModel: "gemini-model-test",
  allowLocalMockIdentity: false,
  accountStoreMode: "memory",
};

describe("gateway API boundary", () => {
  it("uses a product session, minimal projection, and returns a proposal", async () => {
    const modelClient: ModelClient = {
      generate: vi.fn(async () => ({
        summary: "候选旋律",
        notes: [{ start: 0, dur: 1, pitch: 60, vel: 90 }],
      })),
    };
    const api = createGatewayApi(config, { modelClient });
    const registration = await api.execute({
      method: "POST",
      path: "/v1/account/register",
      origin: config.allowedOrigin,
      body: { email: "composer@example.com", password: "a secure password" },
    });
    expect(registration).toMatchObject({ status: 201 });
    const login = await api.execute({
      method: "POST",
      path: "/v1/account/login",
      origin: config.allowedOrigin,
      body: { email: "composer@example.com", password: "a secure password" },
    });
    const loginBody = login.body as { session: { accessToken: string } };
    const generation = await api.execute({
      method: "POST",
      path: "/v1/generation/notes",
      origin: config.allowedOrigin,
      authorization: `Bearer ${loginBody.session.accessToken}`,
      body: {
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
      },
    });

    expect(generation.status).toBe(200);
    expect(generation.body).toMatchObject({
      proposal: { notes: [{ pitch: 60 }] },
    });
    expect(modelClient.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ prompt: "写一条旋律" }),
      }),
    );
  });

  it("rejects a non-allowed browser origin before it reaches account routes", async () => {
    const api = createGatewayApi(config);
    await expect(
      api.execute({
        method: "POST",
        path: "/v1/account/register",
        origin: "https://untrusted.example",
        body: { email: "composer@example.com", password: "a secure password" },
      }),
    ).rejects.toMatchObject({ status: 403, code: "origin_not_allowed" });
  });

  it("runs the explicitly enabled local model, mock redirect, and usage ledger without OpenAI", async () => {
    const api = createGatewayApi({
      ...config,
      modelProvider: "local-demo",
      allowLocalMockIdentity: true,
    });
    const start = await api.execute({
      method: "GET",
      path: "/v1/auth/mock/start",
      origin: config.allowedOrigin,
      query: new URLSearchParams({
        return_to: "http://localhost:1420/?from=local-demo",
        email: "demo@local.test",
      }),
    });
    expect(start.status).toBe(302);
    const code = new URL(start.redirectTo ?? "").searchParams.get(
      "local_ai_code",
    );
    expect(code).toBeTruthy();
    const exchange = await api.execute({
      method: "POST",
      path: "/v1/auth/mock/exchange",
      origin: config.allowedOrigin,
      body: { code },
    });
    const exchangeBody = exchange.body as {
      session: { accessToken: string };
      localDemo: boolean;
    };
    expect(exchangeBody.localDemo).toBe(true);

    const usageBefore = await api.execute({
      method: "GET",
      path: "/v1/account/usage",
      origin: config.allowedOrigin,
      authorization: `Bearer ${exchangeBody.session.accessToken}`,
    });
    expect(usageBefore.body).toMatchObject({
      usage: { dailyUsed: 0, dailyLimit: 4 },
    });
    const generation = await api.execute({
      method: "POST",
      path: "/v1/generation/notes",
      origin: config.allowedOrigin,
      authorization: `Bearer ${exchangeBody.session.accessToken}`,
      body: generationBody(),
    });
    expect(generation.body).toMatchObject({
      proposal: { summary: expect.stringContaining("本地演示") },
    });
    const usageAfter = await api.execute({
      method: "GET",
      path: "/v1/account/usage",
      origin: config.allowedOrigin,
      authorization: `Bearer ${exchangeBody.session.accessToken}`,
    });
    expect(usageAfter.body).toMatchObject({
      usage: { dailyUsed: 1, minuteUsed: 1 },
    });
  });

  it("routes a user-selected Gemini request only to its configured client", async () => {
    const openAiClient: ModelClient = {
      generate: vi.fn(async () => ({ summary: "OpenAI", notes: [] })),
    };
    const geminiClient: ModelClient = {
      generate: vi.fn(async () => ({ summary: "Gemini", notes: [] })),
    };
    const api = createGatewayApi(config, {
      modelClients: { openai: openAiClient, gemini: geminiClient },
    });
    const registration = await api.execute({
      method: "POST",
      path: "/v1/account/register",
      origin: config.allowedOrigin,
      body: { email: "composer@example.com", password: "a secure password" },
    });
    expect(registration.status).toBe(201);
    const login = await api.execute({
      method: "POST",
      path: "/v1/account/login",
      origin: config.allowedOrigin,
      body: { email: "composer@example.com", password: "a secure password" },
    });
    const loginBody = login.body as { session: { accessToken: string } };
    const generation = await api.execute({
      method: "POST",
      path: "/v1/generation/notes",
      origin: config.allowedOrigin,
      authorization: `Bearer ${loginBody.session.accessToken}`,
      body: { ...generationBody(), provider: "gemini" },
    });

    expect(generation.body).toMatchObject({ provider: "gemini" });
    expect(geminiClient.generate).toHaveBeenCalledOnce();
    expect(openAiClient.generate).not.toHaveBeenCalled();
  });
});

function generationBody() {
  return {
    prompt: "本地演示",
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
  };
}
