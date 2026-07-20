import { GatewayError } from "./errors.js";
import type {
  ModelClient,
  ModelGenerationRequest,
  NoteProposal,
} from "./types.js";
import { validateModelProposal } from "./validation.js";

export interface GeminiInteractionsClientOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  fetchImplementation?: typeof fetch;
}

/**
 * Isolated Gemini adapter. It is the only code that knows Gemini's
 * Interactions API and keeps the API key outside the desktop process.
 */
export class GeminiInteractionsClient implements ModelClient {
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: GeminiInteractionsClientOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async generate(request: ModelGenerationRequest): Promise<NoteProposal> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchImplementation(
        "https://generativelanguage.googleapis.com/v1beta/interactions",
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.options.apiKey,
            "X-Client-Request-Id": request.requestId,
          },
          body: JSON.stringify(
            createGeminiInteractionPayload(request, this.options),
          ),
        },
      );
      if (!response.ok) throw providerError(response.status);
      const body = (await response.json()) as unknown;
      const outputText = extractOutputText(body);
      let proposal: unknown;
      try {
        proposal = JSON.parse(outputText);
      } catch {
        throw invalidModelResponse();
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

export function createGeminiInteractionPayload(
  request: ModelGenerationRequest,
  options: Pick<GeminiInteractionsClientOptions, "model" | "maxOutputTokens">,
): Record<string, unknown> {
  const scope = request.request.scope;
  return {
    model: options.model,
    store: false,
    system_instruction: [
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
    input: request.request.prompt,
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: {
        type: "object",
        required: ["summary", "notes"],
        properties: {
          // Keep to Gemini's documented structured-output schema subset.
          // The gateway applies the stricter length/property checks afterwards.
          summary: { type: "string" },
          notes: {
            type: "array",
            maxItems: 64,
            items: {
              type: "object",
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
    generation_config: {
      max_output_tokens: options.maxOutputTokens,
    },
  };
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
  if (typeof raw !== "object" || raw === null) throw invalidModelResponse();
  const response = raw as {
    output_text?: unknown;
    steps?: Array<{
      type?: unknown;
      content?: Array<{ type?: unknown; text?: unknown }>;
    }>;
  };
  if (typeof response.output_text === "string") return response.output_text;
  for (const step of response.steps ?? []) {
    if (step.type !== "model_output") continue;
    for (const content of step.content ?? []) {
      if (content.type === "text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  throw invalidModelResponse();
}

function invalidModelResponse(): GatewayError {
  return new GatewayError(
    502,
    "invalid_model_response",
    "生成服务返回了无效候选，请重试。",
  );
}
