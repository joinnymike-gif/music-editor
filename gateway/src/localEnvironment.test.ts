import { describe, expect, it } from "vitest";
import { parseEnvironmentFile } from "./localEnvironment.js";

describe("local gateway environment", () => {
  it("parses a small local-only configuration without interpreting shell syntax", () => {
    expect(
      parseEnvironmentFile(
        [
          "# never commit this file",
          'OPENAI_API_KEY="sk-local-test"',
          'GEMINI_API_KEY="gemini-local-test"',
          "GATEWAY_SESSION_SECRET='a local secret'",
          "GATEWAY_MODEL_PROVIDER=openai",
        ].join("\n"),
      ),
    ).toEqual({
      OPENAI_API_KEY: "sk-local-test",
      GEMINI_API_KEY: "gemini-local-test",
      GATEWAY_SESSION_SECRET: "a local secret",
      GATEWAY_MODEL_PROVIDER: "openai",
    });
  });

  it("rejects malformed lines instead of accepting shell expressions", () => {
    expect(() => parseEnvironmentFile("OPENAI_API_KEY = value")).toThrow(
      "第 1 行",
    );
  });
});
