// Small statistics helpers for reports. Deterministic: the bootstrap uses a seeded RNG so the
// same data always renders the same report.

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

// Wilson score interval lower bound for k successes out of n (95 % by default).
export function wilsonLower(k: number, n: number, z = 1.96): number {
  if (n === 0) return 0;
  const p = k / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.max(0, (centre - margin) / (1 + z2 / n));
}

// Unbiased pass@k estimator (Chen et al. 2021): chance that at least one of k samples drawn
// from n attempts with c passes is a pass.
export function passAtK(n: number, c: number, k: number): number {
  if (n === 0 || k > n) return 0;
  if (n - c < k) return 1;
  let prod = 1;
  for (let i = n - c + 1; i <= n; i++) prod *= 1 - k / i;
  return 1 - prod;
}

// Mulberry32: tiny seeded PRNG.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 95 % bootstrap interval for mean(b) - mean(a).
export function bootstrapDiff(a: number[], b: number[], iterations = 4000, seed = 42): { diff: number; lo: number; hi: number } {
  const diff = mean(b) - mean(a);
  if (a.length === 0 || b.length === 0) return { diff, lo: Number.NaN, hi: Number.NaN };
  const r = rng(seed);
  const sample = (xs: number[]) => {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(r() * xs.length)]!;
    return s / xs.length;
  };
  const diffs: number[] = [];
  for (let i = 0; i < iterations; i++) diffs.push(sample(b) - sample(a));
  diffs.sort((x, y) => x - y);
  return { diff, lo: diffs[Math.floor(0.025 * iterations)]!, hi: diffs[Math.ceil(0.975 * iterations) - 1]! };
}
