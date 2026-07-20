export type GatewayGenerationStrategy = "replace" | "overdub";

/** Real cloud providers that may be selected by the user. */
export type GatewayModelProvider = "openai" | "gemini";

export type GatewayMusicRole =
  "drums" | "bass" | "harmony" | "lead" | "pad" | "fx";

export interface ProductAccount {
  id: string;
  email: string;
}

export interface ProductSession {
  accessToken: string;
  expiresInSeconds: number;
}

export interface ProductLoginResult {
  account: ProductAccount;
  session: ProductSession;
}

export interface ProductUsage {
  dailyUsed: number;
  dailyLimit: number;
  minuteUsed: number;
  minuteLimit: number;
}

export interface GatewayScopeNote {
  start: number;
  dur: number;
  pitch: number;
  vel: number;
}

export interface GatewayGenerationRequest {
  provider: GatewayModelProvider;
  prompt: string;
  strategy: GatewayGenerationStrategy;
  scope: {
    trackId: string;
    sectionId: string;
    sectionBeats: number;
    role: GatewayMusicRole;
    tempo: number;
    key: string;
    mode: "major" | "minor";
  };
  contextNotes: GatewayScopeNote[];
}

export interface GatewayNoteProposal {
  summary: string;
  notes: GatewayScopeNote[];
}

export class GatewayClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly requestId?: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "GatewayClientError";
  }
}

export class GatewayClient {
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(baseUrl: string, fetchImplementation: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchImplementation = fetchImplementation;
  }

  async register(email: string, password: string): Promise<ProductAccount> {
    const result = await this.request<{ account: ProductAccount }>(
      "/v1/account/register",
      { email, password },
    );
    return result.account;
  }

  async login(email: string, password: string): Promise<ProductLoginResult> {
    return this.request("/v1/account/login", { email, password });
  }

  async logout(accessToken: string): Promise<void> {
    await this.request("/v1/account/logout", undefined, accessToken);
  }

  async generateNotes(
    accessToken: string,
    request: GatewayGenerationRequest,
    signal?: AbortSignal,
  ): Promise<GatewayNoteProposal> {
    const result = await this.request<{ proposal: GatewayNoteProposal }>(
      "/v1/generation/notes",
      request,
      accessToken,
      signal,
    );
    return result.proposal;
  }

  async getUsage(accessToken: string): Promise<ProductUsage> {
    const result = await this.request<{ usage: ProductUsage }>(
      "/v1/account/usage",
      undefined,
      accessToken,
      undefined,
      "GET",
    );
    return result.usage;
  }

  private async request<T>(
    path: string,
    body?: object,
    accessToken?: string,
    signal?: AbortSignal,
    method: "GET" | "POST" = "POST",
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        method,
        signal,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      if (signal?.aborted) {
        throw new GatewayClientError(
          "request_cancelled",
          "已取消生成请求，当前工程没有发生改变。",
        );
      }
      throw new GatewayClientError(
        "network_error",
        "无法连接本机 AI 网关。请确认本地网关已启动，或继续手工编辑。",
      );
    }

    if (response.status === 204) return undefined as T;
    const payload = await parseJson(response);
    if (!response.ok) {
      const error = readError(payload);
      throw new GatewayClientError(
        error.code,
        error.message,
        response.status,
        readRequestId(payload, response),
        parseRetryAfter(response.headers.get("Retry-After")),
      );
    }
    return payload as T;
  }
}

export function configuredGatewayUrl(): string | null {
  const value = import.meta.env.VITE_GATEWAY_URL?.trim();
  return value ? value.replace(/\/$/, "") : null;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new GatewayClientError(
      "invalid_gateway_response",
      "本机 AI 网关返回了无效响应，请稍后重试。",
      response.status,
      response.headers.get("X-Request-Id") ?? undefined,
    );
  }
}

function readError(payload: unknown): { code: string; message: string } {
  if (typeof payload !== "object" || payload === null) {
    return {
      code: "gateway_error",
      message: "本机 AI 网关暂时不可用，请稍后重试。",
    };
  }
  const error = (payload as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return {
      code: "gateway_error",
      message: "本机 AI 网关暂时不可用，请稍后重试。",
    };
  }
  const value = error as { code?: unknown; message?: unknown };
  return {
    code: typeof value.code === "string" ? value.code : "gateway_error",
    message:
      typeof value.message === "string"
        ? value.message
        : "本机 AI 网关暂时不可用，请稍后重试。",
  };
}

function readRequestId(
  payload: unknown,
  response: Response,
): string | undefined {
  if (typeof payload === "object" && payload !== null) {
    const value = (payload as { requestId?: unknown }).requestId;
    if (typeof value === "string") return value;
  }
  return response.headers.get("X-Request-Id") ?? undefined;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}
