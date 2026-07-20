import { invoke } from "@tauri-apps/api/core";
import { assertDesktopRuntime } from "../lifecycle/tauriRuntime";
import type {
  GatewayGenerationRequest,
  GatewayModelProvider,
  GatewayNoteProposal,
} from "./gatewayClient";

export interface DesktopAiProviderStatus {
  provider: GatewayModelProvider;
  configured: boolean;
}

export interface DesktopAiStatus {
  providers: DesktopAiProviderStatus[];
}

export class DesktopAiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DesktopAiClientError";
  }
}

export type DesktopAiInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

/**
 * Desktop-only AI boundary. API keys cross the WebView only once for storage in
 * macOS Keychain, then all provider requests run in the native Tauri process.
 */
export class DesktopAiClient {
  constructor(
    private readonly invokeImplementation: DesktopAiInvoke = invoke as DesktopAiInvoke,
    private readonly assertRuntime: () => void = assertDesktopRuntime,
  ) {}

  async getStatus(): Promise<DesktopAiStatus> {
    return this.call("get_desktop_ai_status");
  }

  async saveKey(
    provider: GatewayModelProvider,
    apiKey: string,
  ): Promise<DesktopAiStatus> {
    return this.call("save_desktop_ai_key", { provider, apiKey });
  }

  async removeKey(provider: GatewayModelProvider): Promise<DesktopAiStatus> {
    return this.call("remove_desktop_ai_key", { provider });
  }

  async generateNotes(
    request: GatewayGenerationRequest,
  ): Promise<GatewayNoteProposal> {
    const result = await this.call<{
      provider: GatewayModelProvider;
      proposal: GatewayNoteProposal;
    }>("generate_desktop_ai_notes", { request });
    return result.proposal;
  }

  private async call<T>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    this.assertRuntime();
    try {
      return await this.invokeImplementation<T>(command, args);
    } catch (cause) {
      throw asDesktopAiError(cause);
    }
  }
}

function asDesktopAiError(cause: unknown): DesktopAiClientError {
  if (typeof cause === "object" && cause !== null) {
    const value = cause as { code?: unknown; message?: unknown };
    if (typeof value.code === "string" && typeof value.message === "string") {
      return new DesktopAiClientError(value.code, value.message);
    }
  }
  if (cause instanceof Error) {
    return new DesktopAiClientError("native_ai_error", cause.message);
  }
  return new DesktopAiClientError(
    "native_ai_error",
    "桌面 AI 服务暂时不可用，请稍后重试或继续手工编辑。",
  );
}
