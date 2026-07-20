import { describe, expect, it } from "vitest";
import { loadGatewayConfig } from "./config.js";

const baseEnvironment = {
  GATEWAY_SESSION_SECRET: "s".repeat(32),
};

describe("gateway configuration", () => {
  it("requires an explicit local-demo provider before enabling mock identity", () => {
    expect(
      loadGatewayConfig({
        ...baseEnvironment,
        GATEWAY_MODEL_PROVIDER: "local-demo",
        GATEWAY_ALLOW_LOCAL_MOCK_IDENTITY: "true",
      }),
    ).toMatchObject({
      modelProvider: "local-demo",
      allowLocalMockIdentity: true,
    });
    expect(() =>
      loadGatewayConfig({
        ...baseEnvironment,
        GATEWAY_ALLOW_LOCAL_MOCK_IDENTITY: "true",
      }),
    ).toThrow("local-demo");
  });

  it("refuses local-demo in a production process", () => {
    expect(() =>
      loadGatewayConfig({
        ...baseEnvironment,
        NODE_ENV: "production",
        GATEWAY_MODEL_PROVIDER: "local-demo",
      }),
    ).toThrow("local-demo");
  });

  it("keeps OpenAI and Gemini credentials and model settings separate", () => {
    expect(
      loadGatewayConfig({
        ...baseEnvironment,
        GATEWAY_MODEL_PROVIDER: "gemini",
        OPENAI_API_KEY: "openai-secret",
        OPENAI_MODEL: "openai-model",
        GEMINI_API_KEY: "gemini-secret",
        GEMINI_MODEL: "gemini-model",
      }),
    ).toMatchObject({
      modelProvider: "gemini",
      openAiApiKey: "openai-secret",
      openAiModel: "openai-model",
      geminiApiKey: "gemini-secret",
      geminiModel: "gemini-model",
    });
  });
});
