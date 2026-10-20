// Maps a normalised effort level to the native request fields for one model.
// Levels are labels, not equivalences: `high` on one provider is not `high` on another.
// A level a model can't express is `null` -> the pair is reported as unsupported, never remapped.

import { AdapterError, type Effort, type NativeEffort, type ProviderId } from './types.ts';

export interface EffortMapping extends NativeEffort {
  body: Record<string, unknown>;
}

interface Rule {
  provider: ProviderId;
  match: RegExp;
  levels: Record<Effort, EffortMapping | null>;
  source: string;
}

const anthropicAdaptive = (effort: string): EffortMapping => ({
  param: 'thinking.type+output_config.effort',
  value: `adaptive/${effort}`,
  body: { thinking: { type: 'adaptive' }, output_config: { effort } },
});

const openaiReasoning = (effort: string): EffortMapping => ({
  param: 'reasoning.effort',
  value: effort,
  body: { reasoning: { effort } },
});

const geminiLevel = (level: string): EffortMapping => ({
  param: 'generationConfig.thinkingConfig.thinkingLevel',
  value: level,
  body: { generationConfig: { thinkingConfig: { thinkingLevel: level } } },
});

export const EFFORT_RULES: readonly Rule[] = [
  {
    provider: 'anthropic',
    match: /^claude-haiku-5-5$/,
    // Disabled thinking is accepted only at effort high or below; pair it with low.
    levels: {
      none: {
        param: 'thinking.type+output_config.effort',
        value: 'disabled/low',
        body: { thinking: { type: 'disabled' }, output_config: { effort: 'low' } },
      },
      low: anthropicAdaptive('low'),
      medium: anthropicAdaptive('medium'),
      high: anthropicAdaptive('high'),
      max: anthropicAdaptive('max'),
    },
    source: 'claude-api skill, cached 2026-10-06: Haiku 5.5 thinking table',
  },
  {
    provider: 'anthropic',
    match: /^claude-sonnet-5-5$/,
    levels: {
      none: {
        param: 'thinking.type+output_config.effort',
        value: 'between_tools/low',
        body: { thinking: { type: 'between_tools' }, output_config: { effort: 'low' } },
      },
      low: anthropicAdaptive('low'),
      medium: anthropicAdaptive('medium'),
      high: anthropicAdaptive('high'),
      max: anthropicAdaptive('max'),
    },
    source: 'claude-api skill, cached 2026-10-06: Sonnet 5.5 thinking table',
  },
  {
    provider: 'anthropic',
    // Thinking can't be disabled on these models.
    match: /^claude-(opus-5-5|fable-5-1)$/,
    levels: {
      none: null,
      low: anthropicAdaptive('low'),
      medium: anthropicAdaptive('medium'),
      high: anthropicAdaptive('high'),
      max: anthropicAdaptive('max'),
    },
    source: 'claude-api skill, cached 2026-10-06: Opus 5.5 / Fable 5.1 thinking table',
  },
  {
    provider: 'openai',
    match: /^gpt-5\.4-(mini|nano)-\d{4}-\d{2}-\d{2}$/,
    levels: {
      none: openaiReasoning('none'),
      low: openaiReasoning('low'),
      medium: openaiReasoning('medium'),
      high: openaiReasoning('high'),
      max: openaiReasoning('xhigh'),
    },
    source: 'developers.openai.com/api/docs/models/gpt-5.4-mini, 2026-10-21',
  },
  {
    provider: 'google',
    // Lowest level is `minimal` (thinking stays on), so `none` is unsupported; no level above `high`.
    match: /^gemini-3\.5-flash-lite$/,
    levels: {
      none: null,
      low: geminiLevel('low'),
      medium: geminiLevel('medium'),
      high: geminiLevel('high'),
      max: null,
    },
    source: 'ai.google.dev/gemini-api/docs/thinking, 2026-10-21',
  },
];

export function findRule(provider: ProviderId, model: string): Rule {
  const rule = EFFORT_RULES.find((r) => r.provider === provider && r.match.test(model));
  if (!rule) {
    throw new AdapterError('config', `No effort rule for ${provider}/${model}; add one to adapters/effort.ts`);
  }
  return rule;
}

export function isSupported(provider: ProviderId, model: string, effort: Effort): boolean {
  return findRule(provider, model).levels[effort] !== null;
}

export function mapEffort(provider: ProviderId, model: string, effort: Effort): EffortMapping {
  const mapping = findRule(provider, model).levels[effort];
  if (!mapping) {
    throw new AdapterError('unsupported', `${provider}/${model} does not support effort '${effort}'`);
  }
  return mapping;
}

// Shallow-by-key deep merge for plain objects, used to fold effort fields into a request body.
export function mergeBody(base: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const cur = out[k];
    out[k] = isPlainObject(cur) && isPlainObject(v) ? mergeBody(cur, v) : v;
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
