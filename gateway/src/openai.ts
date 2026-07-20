import { createHash } from "node:crypto";
import { GatewayError } from "./errors.js";
import type {
  ModelClient,
  ModelGenerationRequest,
  NoteProposal,
} from "./types.js";
import { validateModelProposal } from "./validation.js";

export interface OpenAiResponsesClientOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  fetchImplementation?: typeof fetch;
}

/**
 * The only module that knows the OpenAI HTTP API. It receives a product user
 * identity, derives a one-way safety identifier, and never exposes the API key.
 */
export class OpenAiResponsesClient implements ModelClient {
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: OpenAiResponsesClientOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async generate(request: ModelGenerationRequest): Promise<NoteProposal> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchImplementation(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
            "X-Client-Request-Id": request.requestId,
          },
          body: JSON.stringify(createResponsePayload(request, this.options)),
        },
      );
      if (!response.ok) throw providerError(response.status);
      const body = (await response.json()) as unknown;
      const outputText = extractOutputText(body);
      let proposal: unknown;
      try {
        proposal = JSON.parse(outputText);
      } catch {
        throw new GatewayError(
          502,
          "invalid_model_response",
          "生成服务返回了无效候选，请重试。",
        );
      }
      return validateModelProposal(
        proposal,
        request.request.scope.sectionBeats,
      );
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      if (controller.signal.aborted) {
        throw new GatewayError(
          504,
          "generation_timeout",
          "生成超时，未自动重试。请确认后手动重试。",
        );
      }
      throw new GatewayError(
        502,
        "provider_unavailable",
        "生成服务暂时不可用，请稍后重试。",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createResponsePayload(
  request: ModelGenerationRequest,
  options: Pick<OpenAiResponsesClientOptions, "model" | "maxOutputTokens">,
): Record<string, unknown> {
  const scope = request.request.scope;
  return {
    model: options.model,
    store: false,
    max_output_tokens: options.maxOutputTokens,
    safety_identifier: createSafetyIdentifier(request.account.id),
    input: [
      {
        role: "developer",
        content: [
          {
            type: "input_text",
            text: [
              "You create a small MIDI-note proposal for a music editor.",
              "Return only the requested JSON schema. Notes must stay inside the selected section.",
              "Do not include IDs, markdown, credentials, personal data, or operations.",
              `Selected scope: ${JSON.stringify({
                sectionBeats: scope.sectionBeats,
                role: scope.role,
                tempo: scope.tempo,
                key: scope.key,
                mode: scope.mode,
                strategy: request.request.strategy,
                contextNotes: request.request.contextNotes,
              })}`,
            ].join("\n"),
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: request.request.prompt }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "music_note_proposal",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["summary", "notes"],
          properties: {
            summary: { type: "string", minLength: 1, maxLength: 300 },
            notes: {
              type: "array",
              maxItems: 64,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["start", "dur", "pitch", "vel"],
                properties: {
                  start: { type: "number" },
                  dur: { type: "number" },
                  pitch: { type: "integer", minimum: 0, maximum: 127 },
                  vel: { type: "integer", minimum: 1, maximum: 127 },
                },
              },
            },
          },
        },
      },
    },
  };
}

export function createSafetyIdentifier(accountId: string): string {
  return createHash("sha256").update(`music-editor:${accountId}`).digest("hex");
}

function providerError(status: number): GatewayError {
  if (status === 401 || status === 403) {
    return new GatewayError(
      503,
      "provider_configuration_error",
      "生成服务配置暂时不可用。",
    );
  }
  if (status === 429) {
    return new GatewayError(
      429,
      "provider_rate_limited",
      "生成服务繁忙，请稍后手动重试。",
    );
  }
  if (status >= 500) {
    return new GatewayError(
      503,
      "provider_unavailable",
      "生成服务暂时不可用，请稍后重试。",
    );
  }
  return new GatewayError(
    502,
    "provider_request_failed",
    "生成服务未能完成请求，请修改后重试。",
  );
}

function extractOutputText(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) {
    throw new GatewayError(
      502,
      "invalid_model_response",
      "生成服务返回了无效候选，请重试。",
    );
  }
  const response = raw as {
    output_text?: unknown;
    output?: Array<{
      type?: unknown;
      content?: Array<{
        type?: unknown;
        text?: unknown;
        refusal?: unknown;
      }>;
    }>;
  };
  if (typeof response.output_text === "string") return response.output_text;
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
      if (content.type === "refusal" && typeof content.refusal === "string") {
        throw new GatewayError(
          422,
          "model_refused",
          "生成服务拒绝了这次请求。请修改描述或改用手工编辑。",
        );
      }
    }
  }
  throw new GatewayError(
    502,
    "invalid_model_response",
    "生成服务返回了无效候选，请重试。",
  );
}
