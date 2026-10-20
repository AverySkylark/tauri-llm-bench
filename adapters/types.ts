// Provider-neutral request/response shapes shared by every adapter.

export const EFFORTS = ['none', 'low', 'medium', 'high', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export type ProviderId = 'anthropic' | 'openai' | 'google';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  // Provider-native assistant payload (e.g. thinking blocks), replayed unchanged
  // to the same adapter on the next turn. Never shown to another provider.
  native?: unknown;
}

export interface ChatRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  effort: Effort;
  maxOutputTokens: number;
  // 'provider_default' means the field is not sent at all.
  temperature: number | 'provider_default';
  timeoutMs: number;
}

// Tokens as billed. `output` includes reasoning tokens; `reasoning` is the subset
// the provider reports separately (null when the provider doesn't break it out).
export interface Usage {
  input: number;
  cachedInput: number;
  output: number;
  reasoning: number | null;
}

export type StopReason = 'end' | 'max_tokens' | 'refusal' | 'other';

export interface NativeEffort {
  // Dotted request path(s) and value(s) actually sent, for the run record.
  param: string;
  value: string;
}

export interface ChatResponse {
  text: string;
  stopReason: StopReason;
  stopReasonNative: string;
  usage: Usage;
  latencyMs: number;
  effortNative: NativeEffort;
  temperatureSent: number | null;
  native: unknown;
}

export type Transport = (url: string, init: RequestInit) => Promise<Response>;

export interface Adapter {
  provider: ProviderId;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export class AdapterError extends Error {
  readonly kind: 'http' | 'timeout' | 'parse' | 'unsupported' | 'config';
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(kind: AdapterError['kind'], message: string, status: number | null = null) {
    super(message);
    this.name = 'AdapterError';
    this.kind = kind;
    this.status = status;
    this.retryable = kind === 'timeout' || (status !== null && (status === 429 || status >= 500));
  }
}
