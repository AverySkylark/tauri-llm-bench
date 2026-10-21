# Status

Updated 2026-10-21, end of Phase 2. Awaiting owner review of the task suite for bias.

## Phases

| Phase | State | Branch / commit |
|---|---|---|
| 0 Plan | done | `phase-0-plan` |
| 1 Scaffold, matrix, prices, schemas, adapters | done | `phase-1-scaffold` |
| 2 Task suite A–D, hidden tests, verification | done, **awaiting bias review** | `phase-2-tasks` |
| 3 Orchestrator (`bench run`) | not started | |
| 4 Live smoke (1 model, task A, N=1, ≤ $1) | not started | |
| 5 Reports | not started | |
| 6 CI, Pages, RUNBOOK | not started | |
| 7 Full sweep | not started | |

Branches are stacked (each phase branches from the previous one). No remote exists yet, so nothing is merged to `main` and no PRs are open.

## Decisions made

Full log in `docs/DECISIONS.md`. Key ones:
- Harness: TypeScript on Node 24, raw `fetch` to all three providers, npm.
- Non-agentic loop: whole-file edits, harness runs gates and feeds errors back (R ≤ 2). Adopted from Phase 0 defaults when the owner said "go".
- Effort levels a model can't express are refused, never remapped.
- Gates run on Tauri's mock runtime (no WebView) with one shared, offline, locked dependency cache.
- Hidden tests and references are encrypted in `hidden/tasks.enc`. Key: `~/.tauri-llm-bench/hidden.key` or `BENCH_HIDDEN_KEY`.
- ESLint preset is `recommendedTypeChecked` (strict measured style, not correctness).

## Open questions for the owner

1. Bias review of the four tasks: `docs/TASKS.md` lists what to look at (exact-string assertions, Tauri 2 knowledge, lint as a gate, author bias).
2. Should ESLint stay a pass/fail gate, or become a hygiene metric only?
3. Back up `~/.tauri-llm-bench/hidden.key`; without it the hidden tests can't be decrypted.
4. Still unanswered from Phase 0: judge setup, λ, and whether the repo will be public. Defaults are in use.

## Next step

After the owner approves the tasks (or asks for changes): **Phase 3**: build `harness/orchestrator/` with `bench run --matrix`, `--model/--effort/--task` and `--only-new`. It needs:
- the prompt builder and the whole-file output parser, including deletes (D's prompt asks the model to delete `src/scanApi.ts`);
- enforcement of the editable-path whitelist;
- the retry loop with gate errors fed back;
- timeout, token and dollar caps;
- the NDJSON writer validated against `schema/run.schema.json`;
- an end-to-end dry run.

Gate time per attempt is about 10–12 s warm on the dev box.

## How to resume

```
npm ci && (cd tasks/_shared/frontend && npm ci)
npm run bench -- hidden decrypt
npm run bench -- tasks prepare
npm run bench -- tasks verify
npm test
```
