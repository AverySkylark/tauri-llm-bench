import { describe, expect, it } from 'vitest';
import { EFFORT_RULES, findRule, isSupported, mapEffort } from '../adapters/effort.ts';
import { AdapterError, EFFORTS } from '../adapters/types.ts';
import { loadMatrix } from '../harness/matrix.ts';
import { repoPath } from '../harness/paths.ts';
import { loadPrices } from '../harness/prices.ts';

describe('effort normalisation', () => {
  it('every rule defines all five normalised levels', () => {
    for (const r of EFFORT_RULES) expect(Object.keys(r.levels).sort()).toEqual([...EFFORTS].sort());
  });

  it('every priced model has exactly one effort rule', () => {
    const prices = loadPrices('v1');
    for (const [model, p] of Object.entries(prices.models)) {
      expect(EFFORT_RULES.filter((r) => r.provider === p.provider && r.match.test(model)), model).toHaveLength(1);
    }
  });

  it('maps Anthropic levels to adaptive thinking + output_config.effort', () => {
    expect(mapEffort('anthropic', 'claude-haiku-5-5', 'high').body).toEqual({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
    });
    expect(mapEffort('anthropic', 'claude-haiku-5-5', 'none').value).toBe('disabled/low');
  });

  it('maps OpenAI max to xhigh and records the native value', () => {
    const m = mapEffort('openai', 'gpt-5.4-mini-2026-03-17', 'max');
    expect(m).toMatchObject({ param: 'reasoning.effort', value: 'xhigh', body: { reasoning: { effort: 'xhigh' } } });
  });

  it('marks levels a model cannot express as unsupported instead of remapping', () => {
    expect(isSupported('google', 'gemini-3.5-flash-lite', 'none')).toBe(false);
    expect(isSupported('google', 'gemini-3.5-flash-lite', 'max')).toBe(false);
    expect(isSupported('anthropic', 'claude-opus-5-5', 'none')).toBe(false);
    expect(() => mapEffort('google', 'gemini-3.5-flash-lite', 'max')).toThrow(AdapterError);
  });

  it('refuses unknown models rather than guessing', () => {
    expect(() => findRule('openai', 'gpt-5.4-mini')).toThrow(/No effort rule/); // alias, not a snapshot
    expect(() => findRule('anthropic', 'claude-haiku-9')).toThrow(/No effort rule/);
  });

  it('the starter matrix only contains supported pairs', () => {
    const { pairs } = loadMatrix(repoPath('matrix', 'matrix.yaml'));
    expect(pairs).toHaveLength(7);
    expect(pairs.every((p) => p.supported)).toBe(true);
  });
});
