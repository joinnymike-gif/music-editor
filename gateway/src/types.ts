export type MusicRole = "drums" | "bass" | "harmony" | "lead" | "pad" | "fx";

export type GenerationStrategy = "replace" | "overdub";

/** Providers that a desktop user may select for a real generation request. */
export type ExternalModelProvider = "openai" | "gemini";

/** local-demo is deliberately test-only and never selectable by the desktop UI. */
export type ModelProvider = ExternalModelProvider | "local-demo";

export interface ScopeNote {
  start: number;
  dur: number;
  pitch: number;
  vel: number;
}

/** A deliberately small, non-identifying project projection sent to the model. */
export interface GenerationScope {
  trackId: string;
  sectionId: string;
  sectionBeats: number;
  role: MusicRole;
  tempo: number;
  key: string;
  mode: "major" | "minor";
}

export interface GenerateNotesRequest {
  /** Optional for backwards-compatible callers; the gateway falls back to its default. */
  provider?: ExternalModelProvider;
  prompt: string;
  strategy: GenerationStrategy;
  scope: GenerationScope;
  /** Existing notes in this clip only, capped by the gateway. */
  contextNotes: ScopeNote[];
}

export type GeneratedNote = ScopeNote;

export interface NoteProposal {
  summary: string;
  notes: GeneratedNote[];
}

export interface AuthenticatedAccount {
  id: string;
  email: string;
}

export interface SessionClaims {
  sub: string;
  email: string;
  iat: number;
  exp: number;
  jti: string;
  v: 1;
}

export interface ModelGenerationRequest {
  account: AuthenticatedAccount;
  request: GenerateNotesRequest;
  requestId: string;
}

export interface ModelClient {
  generate(request: ModelGenerationRequest): Promise<NoteProposal>;
}

export interface GatewayConfig {
  port: number;
  allowedOrigin: string;
  sessionSecret: string;
  sessionTtlSeconds: number;
  requestTimeoutMs: number;
  requestsPerMinute: number;
  dailyGenerationLimit: number;
  maxPromptChars: number;
  maxOutputTokens: number;
  /** Default only; each desktop generation request may select an external provider. */
  modelProvider: ModelProvider;
  openAiModel: string;
  geminiModel: string;
  allowLocalMockIdentity: boolean;
  openAiApiKey?: string;
  geminiApiKey?: string;
  accountStoreMode: "memory";
}

export interface GenerationUsage {
  dailyUsed: number;
  dailyLimit: number;
  minuteUsed: number;
  minuteLimit: number;
}

export interface GatewayAuditEvent {
  event:
    "account_registered" | "account_login" | "generation" | "generation_failed";
  requestId: string;
  accountIdHash: string;
  status: number;
  code?: string;
}
