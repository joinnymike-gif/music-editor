import { createHash, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  MemoryAccountStore,
  ProductAuthService,
  type AccountStore,
} from "./auth.js";
import { asGatewayError, GatewayError } from "./errors.js";
import { MemoryGenerationLimiter } from "./limits.js";
import { LocalDemoModelClient } from "./localDemoModel.js";
import { GeminiInteractionsClient } from "./gemini.js";
import { OpenAiResponsesClient } from "./openai.js";
import type {
  GatewayAuditEvent,
  GatewayConfig,
  ModelClient,
  ModelProvider,
} from "./types.js";
import { validateGenerateNotesRequest } from "./validation.js";

const maxBodyBytes = 32 * 1024;

export interface GatewayDependencies {
  accountStore?: AccountStore;
  /** Test seam for one default provider. Prefer modelClients for provider-specific tests. */
  modelClient?: ModelClient;
  modelClients?: Partial<Record<ModelProvider, ModelClient>>;
  audit?: (event: GatewayAuditEvent) => void;
}

export interface GatewayApiRequest {
  method: string;
  path: string;
  origin?: string;
  authorization?: string;
  body?: Record<string, unknown>;
  requestId?: string;
  query?: URLSearchParams;
}

export interface GatewayApiResponse {
  status: number;
  body?: unknown;
  redirectTo?: string;
}

export interface GatewayApi {
  execute(request: GatewayApiRequest): Promise<GatewayApiResponse>;
}

/**
 * Transport-independent gateway boundary. Keeping this separate from Node HTTP
 * lets the account, limit, and generation rules run in desktop CI as well as
 * in a deployed service.
 */
export function createGatewayApi(
  config: GatewayConfig,
  dependencies: GatewayDependencies = {},
): GatewayApi {
  const accounts = dependencies.accountStore ?? new MemoryAccountStore();
  const auth = new ProductAuthService(
    accounts,
    config.sessionSecret,
    config.sessionTtlSeconds,
  );
  const limiter = new MemoryGenerationLimiter(
    config.requestsPerMinute,
    config.dailyGenerationLimit,
  );
  const modelClients = createModelClients(config, dependencies);
  const audit = dependencies.audit ?? (() => undefined);

  return {
    async execute(request) {
      enforceOrigin(request.origin, config.allowedOrigin);
      const requestId = request.requestId?.slice(0, 128) || randomUUID();
      if (request.method === "GET" && request.path === "/health") {
        return {
          status: 200,
          body: {
            status: "ok",
            ai: modelClients.size > 0 ? "configured" : "not_configured",
            modelProvider: config.modelProvider,
            configuredProviders: [...modelClients.keys()],
            localMockIdentity: config.allowLocalMockIdentity,
            accountStore:
              config.accountStoreMode === "memory"
                ? "development-memory"
                : "unknown",
            requestId,
          },
        };
      }
      if (request.method === "GET" && request.path === "/v1/auth/mock/start") {
        if (!config.allowLocalMockIdentity) {
          throw new GatewayError(404, "not_found", "未找到请求的接口。");
        }
        const returnTo = request.query?.get("return_to");
        const email = request.query?.get("email") ?? "demo@local.test";
        const redirectUrl = validateLocalMockReturnTo(
          returnTo,
          config.allowedOrigin,
        );
        const code = await auth.beginLocalMockIdentity(email);
        redirectUrl.searchParams.set("local_ai_code", code);
        return { status: 302, redirectTo: redirectUrl.toString() };
      }
      if (
        request.method === "POST" &&
        request.path === "/v1/auth/mock/exchange"
      ) {
        if (!config.allowLocalMockIdentity) {
          throw new GatewayError(404, "not_found", "未找到请求的接口。");
        }
        const result = await auth.exchangeLocalMockIdentity(
          requireBody(request.body).code,
        );
        audit({
          event: "account_login",
          requestId,
          accountIdHash: hashAccountId(result.account.id),
          status: 200,
        });
        return {
          status: 200,
          body: {
            account: result.account,
            session: {
              accessToken: result.accessToken,
              expiresInSeconds: config.sessionTtlSeconds,
            },
            requestId,
            localDemo: true,
          },
        };
      }
      if (
        request.method === "POST" &&
        request.path === "/v1/account/register"
      ) {
        const body = requireBody(request.body);
        const account = await auth.register(body.email, body.password);
        audit({
          event: "account_registered",
          requestId,
          accountIdHash: hashAccountId(account.id),
          status: 201,
        });
        return { status: 201, body: { account, requestId } };
      }
      if (request.method === "POST" && request.path === "/v1/account/login") {
        const body = requireBody(request.body);
        const token = await auth.login(body.email, body.password);
        const account = await auth.authenticate(token);
        audit({
          event: "account_login",
          requestId,
          accountIdHash: hashAccountId(account.id),
          status: 200,
        });
        return {
          status: 200,
          body: {
            account,
            session: {
              accessToken: token,
              expiresInSeconds: config.sessionTtlSeconds,
            },
            requestId,
          },
        };
      }
      if (request.method === "GET" && request.path === "/v1/account/me") {
        const account = await auth.authenticate(
          requireBearerToken(request.authorization),
        );
        return { status: 200, body: { account, requestId } };
      }
      if (request.method === "GET" && request.path === "/v1/account/usage") {
        const account = await auth.authenticate(
          requireBearerToken(request.authorization),
        );
        return {
          status: 200,
          body: { usage: limiter.getUsage(account.id), requestId },
        };
      }
      if (request.method === "POST" && request.path === "/v1/account/logout") {
        const token = requireBearerToken(request.authorization);
        const account = await auth.authenticate(token);
        auth.revoke(token);
        audit({
          event: "account_login",
          requestId,
          accountIdHash: hashAccountId(account.id),
          status: 204,
        });
        return { status: 204 };
      }
      if (
        request.method === "POST" &&
        request.path === "/v1/generation/notes"
      ) {
        const account = await auth.authenticate(
          requireBearerToken(request.authorization),
        );
        const generationRequest = validateGenerateNotesRequest(
          requireBody(request.body),
          config.maxPromptChars,
        );
        const modelProvider =
          generationRequest.provider ?? config.modelProvider;
        const modelClient = modelClients.get(modelProvider);
        if (!modelClient) {
          throw new GatewayError(
            503,
            "ai_not_configured",
            `所选 ${providerDisplayName(modelProvider)} 生成服务尚未配置，请稍后再试。`,
          );
        }
        limiter.consume(account.id);
        try {
          const proposal = await modelClient.generate({
            account,
            request: generationRequest,
            requestId,
          });
          audit({
            event: "generation",
            requestId,
            accountIdHash: hashAccountId(account.id),
            status: 200,
          });
          return {
            status: 200,
            body: { proposal, provider: modelProvider, requestId },
          };
        } catch (error) {
          const gatewayError = asGatewayError(error);
          audit({
            event: "generation_failed",
            requestId,
            accountIdHash: hashAccountId(account.id),
            status: gatewayError.status,
            code: gatewayError.code,
          });
          throw gatewayError;
        }
      }
      throw new GatewayError(404, "not_found", "未找到请求的接口。");
    },
  };
}

function createModelClients(
  config: GatewayConfig,
  dependencies: GatewayDependencies,
): Map<ModelProvider, ModelClient> {
  const clients = new Map<ModelProvider, ModelClient>();
  for (const [provider, client] of Object.entries(
    dependencies.modelClients ?? {},
  ) as Array<[ModelProvider, ModelClient | undefined]>) {
    if (client) clients.set(provider, client);
  }
  if (dependencies.modelClient) {
    clients.set(config.modelProvider, dependencies.modelClient);
  }
  if (clients.size > 0) return clients;

  if (config.modelProvider === "local-demo") {
    clients.set("local-demo", new LocalDemoModelClient());
    return clients;
  }
  if (config.openAiApiKey) {
    clients.set(
      "openai",
      new OpenAiResponsesClient({
        apiKey: config.openAiApiKey,
        model: config.openAiModel,
        timeoutMs: config.requestTimeoutMs,
        maxOutputTokens: config.maxOutputTokens,
      }),
    );
  }
  if (config.geminiApiKey) {
    clients.set(
      "gemini",
      new GeminiInteractionsClient({
        apiKey: config.geminiApiKey,
        model: config.geminiModel,
        timeoutMs: config.requestTimeoutMs,
        maxOutputTokens: config.maxOutputTokens,
      }),
    );
  }
  return clients;
}

function providerDisplayName(provider: ModelProvider): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "gemini") return "Gemini";
  return "本地演示";
}

/** Node HTTP adapter; all authorization and generation rules live in GatewayApi. */
export function createGatewayServer(
  config: GatewayConfig,
  dependencies: GatewayDependencies = {},
): Server {
  const api = createGatewayApi(config, dependencies);
  return createServer(async (request, response) => {
    let requestId: string = randomUUID();
    try {
      const suppliedRequestId = singleHeader(request.headers["x-request-id"]);
      requestId = suppliedRequestId?.slice(0, 128) || requestId;
      setSecurityHeaders(response, requestId);
      const origin = singleHeader(request.headers.origin);
      enforceOrigin(origin, config.allowedOrigin);
      if (origin) setCorsHeaders(response, config.allowedOrigin);
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      const requestUrl = new URL(request.url ?? "/", "http://gateway.local");
      const path = requestUrl.pathname;
      const body = requiresJsonBody(request.method, path)
        ? await readJsonBody(request)
        : undefined;
      const result = await api.execute({
        method: request.method ?? "GET",
        path,
        origin,
        authorization: singleHeader(request.headers.authorization),
        body,
        requestId,
        query: requestUrl.searchParams,
      });
      if (result.redirectTo) {
        response.statusCode = result.status;
        response.setHeader("Location", result.redirectTo);
        response.end();
        return;
      }
      sendJson(response, result.status, result.body);
    } catch (error) {
      setSecurityHeaders(response, requestId);
      const gatewayError = asGatewayError(error);
      if (gatewayError.retryAfterSeconds) {
        response.setHeader(
          "Retry-After",
          String(gatewayError.retryAfterSeconds),
        );
      }
      sendJson(response, gatewayError.status, {
        error: { code: gatewayError.code, message: gatewayError.message },
        requestId,
      });
    }
  });
}

function enforceOrigin(
  origin: string | undefined,
  allowedOrigin: string,
): void {
  if (origin && origin !== allowedOrigin) {
    throw new GatewayError(403, "origin_not_allowed", "请求来源不受允许。");
  }
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Request-Id",
    Vary: "Origin",
  };
}

function setCorsHeaders(response: ServerResponse, origin: string): void {
  for (const [name, value] of Object.entries(corsHeaders(origin))) {
    response.setHeader(name, value);
  }
}

function requiresJsonBody(method: string | undefined, path: string): boolean {
  return (
    method === "POST" &&
    (path === "/v1/account/register" ||
      path === "/v1/account/login" ||
      path === "/v1/auth/mock/exchange" ||
      path === "/v1/generation/notes")
  );
}

async function readJsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const contentType = singleHeader(request.headers["content-type"]) ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new GatewayError(
      415,
      "json_required",
      "请求必须使用 application/json。",
    );
  }
  let body = "";
  for await (const chunk of request) {
    body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (Buffer.byteLength(body, "utf8") > maxBodyBytes) {
      throw new GatewayError(413, "request_too_large", "请求内容过大。");
    }
  }
  try {
    const parsed = JSON.parse(body) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new GatewayError(400, "invalid_json", "请求 JSON 无效。");
  }
}

function requireBearerToken(authorization: string | undefined): string {
  if (!authorization?.startsWith("Bearer ")) {
    throw new GatewayError(
      401,
      "authentication_required",
      "请先登录本地网关账户。",
    );
  }
  const token = authorization.slice("Bearer ".length).trim();
  if (!token || token.length > 8_192) {
    throw new GatewayError(
      401,
      "authentication_required",
      "请先登录本地网关账户。",
    );
  }
  return token;
}

function requireBody(
  body: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!body) throw new GatewayError(400, "invalid_json", "请求 JSON 无效。");
  return body;
}

function validateLocalMockReturnTo(
  value: string | null | undefined,
  allowedOrigin: string,
): URL {
  if (!value) {
    throw new GatewayError(400, "invalid_return_to", "缺少本地登录回调地址。");
  }
  let returnTo: URL;
  try {
    returnTo = new URL(value);
  } catch {
    throw new GatewayError(400, "invalid_return_to", "本地登录回调地址无效。");
  }
  if (returnTo.origin !== allowedOrigin) {
    throw new GatewayError(
      400,
      "invalid_return_to",
      "本地登录回调来源不受允许。",
    );
  }
  return returnTo;
}

function singleHeader(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    throw new GatewayError(400, "invalid_header", "请求头格式无效。");
  }
  return value;
}

function setSecurityHeaders(response: ServerResponse, requestId: string): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Request-Id", requestId);
}

function sendJson(
  response: ServerResponse,
  status: number,
  body?: unknown,
): void {
  response.statusCode = status;
  if (status === 204) {
    response.end();
    return;
  }
  response.end(JSON.stringify(body));
}

function hashAccountId(accountId: string): string {
  return createHash("sha256").update(accountId).digest("hex").slice(0, 16);
}
