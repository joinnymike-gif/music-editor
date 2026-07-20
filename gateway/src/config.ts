import type { GatewayConfig, ModelProvider } from "./types.js";

const minimumSecretLength = 32;

function requiredInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = environment[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min}–${max} 之间的整数。`);
  }
  return value;
}

function requiredBoolean(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean,
): boolean {
  const raw = environment[name];
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} 必须为 true 或 false。`);
}

function geminiModelName(value: string | undefined): string {
  const model = value?.trim() || "gemini-flash-lite-latest";
  return model.replace(/^models\//, "");
}

/**
 * Loads only deployment settings. Provider credentials stay server-side and
 * are intentionally never exposed through a status or error response.
 */
export function loadGatewayConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  const sessionSecret = environment.GATEWAY_SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < minimumSecretLength) {
    throw new Error(
      `GATEWAY_SESSION_SECRET 必须设置且至少 ${minimumSecretLength} 个字符。`,
    );
  }

  const allowedOrigin =
    environment.GATEWAY_ALLOWED_ORIGIN ?? "http://localhost:1420";
  if (allowedOrigin === "*") {
    throw new Error(
      "GATEWAY_ALLOWED_ORIGIN 不能为通配符。请设置桌面应用的明确来源。",
    );
  }

  const accountStore = environment.GATEWAY_ACCOUNT_STORE ?? "memory";
  if (accountStore !== "memory") {
    throw new Error(
      "当前版本仅提供 development memory 账号存储；生产环境必须注入持久化 AccountStore。",
    );
  }

  const openAiApiKey = environment.OPENAI_API_KEY?.trim();
  const geminiApiKey = environment.GEMINI_API_KEY?.trim();
  const modelProvider = environment.GATEWAY_MODEL_PROVIDER ?? "openai";
  if (
    modelProvider !== "openai" &&
    modelProvider !== "gemini" &&
    modelProvider !== "local-demo"
  ) {
    throw new Error(
      "GATEWAY_MODEL_PROVIDER 必须为 openai、gemini 或 local-demo。",
    );
  }
  if (modelProvider === "local-demo" && environment.NODE_ENV === "production") {
    throw new Error(
      "local-demo 仅限本地开发，不能以 NODE_ENV=production 启动。",
    );
  }
  const allowLocalMockIdentity = requiredBoolean(
    environment,
    "GATEWAY_ALLOW_LOCAL_MOCK_IDENTITY",
    false,
  );
  if (allowLocalMockIdentity && modelProvider !== "local-demo") {
    throw new Error(
      "GATEWAY_ALLOW_LOCAL_MOCK_IDENTITY 只能与 GATEWAY_MODEL_PROVIDER=local-demo 一起使用。",
    );
  }
  return {
    port: requiredInteger(environment, "PORT", 8787, 1, 65_535),
    allowedOrigin,
    sessionSecret,
    sessionTtlSeconds: requiredInteger(
      environment,
      "GATEWAY_SESSION_TTL_SECONDS",
      1_800,
      300,
      86_400,
    ),
    requestTimeoutMs: requiredInteger(
      environment,
      "GATEWAY_REQUEST_TIMEOUT_MS",
      30_000,
      1_000,
      120_000,
    ),
    requestsPerMinute: requiredInteger(
      environment,
      "GATEWAY_REQUESTS_PER_MINUTE",
      4,
      1,
      60,
    ),
    dailyGenerationLimit: requiredInteger(
      environment,
      "GATEWAY_DAILY_GENERATION_LIMIT",
      30,
      1,
      10_000,
    ),
    maxPromptChars: requiredInteger(
      environment,
      "GATEWAY_MAX_PROMPT_CHARS",
      1_600,
      100,
      8_000,
    ),
    maxOutputTokens: requiredInteger(
      environment,
      "GATEWAY_MAX_OUTPUT_TOKENS",
      800,
      100,
      4_000,
    ),
    modelProvider: modelProvider as ModelProvider,
    openAiModel: environment.OPENAI_MODEL?.trim() || "gpt-5.6",
    geminiModel: geminiModelName(environment.GEMINI_MODEL),
    allowLocalMockIdentity,
    openAiApiKey: openAiApiKey || undefined,
    geminiApiKey: geminiApiKey || undefined,
    accountStoreMode: "memory",
  };
}
