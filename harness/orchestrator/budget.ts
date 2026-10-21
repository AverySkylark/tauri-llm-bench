// Run-level dollar ceiling. Every request is checked against its worst case before it is sent,
// so a run can never cross the ceiling, only stop short of it.

import type { ChatMessage } from '../../adapters/types.ts';
import { costUsd, type ModelPrice } from '../prices.ts';

// Code and Markdown tokenise at roughly 3.5–4 characters per token; 3 keeps the estimate high.
const CHARS_PER_TOKEN = 3;

export class Budget {
  spent = 0;
  readonly ceiling: number;

  constructor(ceiling: number) {
    this.ceiling = ceiling;
  }

  allows(worstCaseUsd: number): boolean {
    return this.spent + worstCaseUsd <= this.ceiling + 1e-9;
  }

  add(usd: number): void {
    this.spent = Math.round((this.spent + usd) * 1e8) / 1e8;
  }
}

export function promptChars(system: string, messages: ChatMessage[]): number {
  let n = system.length;
  for (const m of messages) n += m.content.length + (m.native === undefined ? 0 : JSON.stringify(m.native).length);
  return n;
}

export function worstCaseUsd(price: ModelPrice, chars: number, maxOutputTokens: number): number {
  return costUsd(price, { input: Math.ceil(chars / CHARS_PER_TOKEN), cachedInput: 0, output: maxOutputTokens, reasoning: null });
}
