# Plan: Move TUI SQLite polling into a Worker thread + consolidated cache

## Context (read this first)

This plan continues work documented in `opencode-balancer-summary-01.md` (session summary
for `@secondstrikerss/opencode-balancer`, a fork of `@thelioo/opencode-balancer@0.2.18`).

Prior fixes already applied and shipped (do not re-do, do not regress):
- `RETRYABLE_STATUS` includes `402, 403, 429, 500, 502, 503, 504, 529` in
  `src/server/request-balancer.ts`, with `bodyLooksQuotaExceeded()` fallback pattern matching
  in `src/server/fetch-patch.ts`.
- `busy_timeout` was lowered from `5000` to `500` in `src/core/database.ts`.
- `src/tui/safe-poll.ts` exists — a `safePoll()` wrapper that catches transient errors in
  polling callbacks so they can't crash the TUI via an uncaught exception in a bare
  `setInterval`.
- Polling intervals were widened: `sidebar.tsx` / `status-indicator.tsx` / `state.ts`
  500ms→2000ms; `dashboard.tsx` / `priority-screen.tsx` 500ms→1500ms; server-side
  `auth-watcher.ts` 1000ms→2000ms (with `.catch()` on its async poll).
- Quota-aware account selection shipped in `src/core/usage/selection.ts` and
  `src/core/usage/percent.ts`, gated by `quota_aware_selection_enabled`
  (default on) via `getQuotaAwareSelectionEnabled` / `setQuotaAwareSelectionEnabled`
  in the `settings` table.
- Baseline test count at end of that session: **263/263 passing**.

## Problem being solved now

The TUI process and the server process are already separate OS processes, each holding
its own `bun:sqlite` connection to the same database file. That part is correct and
should not change.

The remaining problem is **inside the TUI process**: Bun/Node is single-threaded by
default. The TUI's polling timers (`setInterval` in `sidebar.tsx`, `status-indicator.tsx`,
`state.ts`, `dashboard.tsx`, `priority-screen.tsx`) run their SQLite reads on the **same
thread** that handles keyboard input and rendering. `bun:sqlite` calls are synchronous —
they block the calling thread until they return. When a poll tick collides with a write
lock held by the server process (or is just momentarily slow), the entire TUI thread
stalls, including keystroke handling — producing the "freezes while typing, then
flushes all keystrokes at once" symptom. Lowering `busy_timeout` to 500ms and widening
intervals reduced the frequency and duration of this, but did not eliminate the
mechanism.

## Goal

Move all TUI-side SQLite polling off the main thread into a dedicated `Worker` thread.
The main thread will never call `bun:sqlite` directly. Components read from an in-memory
cache on the main thread, which is updated only via `postMessage` from the worker. This
makes it structurally impossible for a slow/blocked SQLite read to stall keyboard input,
rather than merely making it less likely.

This plan is **Option A** from prior discussion: the worker still polls on a timer
(it does not yet use push/IPC notifications from the server). Cache freshness lag is
therefore bounded by the worker's poll interval (~1000ms suggested), same order of
magnitude as today. This is an accepted tradeoff — see "Explicitly out of scope" below.

## Non-goals / explicitly out of scope for this change

- **Not implementing push-based invalidation** (server notifying TUI over IPC/socket
  when it writes). That is a larger architectural change (Option B) and is intentionally
  deferred. Do not build it as part of this task.
- **Not changing** `src/server/*` files, `busy_timeout`, `RETRYABLE_STATUS`, or the
  quota-aware selection logic. Those are already correct and out of scope.
- **Not changing** `auth-watcher.ts` — it is server-side and already async with
  `.catch()`; it is not part of the main-thread-blocking problem.
- **Not removing** `safe-poll.ts` — it will be reused inside the worker (see Step 2).

---

## Prerequisite: verify assumptions against the real repo before writing code

This plan was written without direct access to the actual source files — only the
session summary above. Before implementing, the implementing agent MUST:

1. `view`/read the actual current contents of:
   - `src/core/database.ts`
   - `src/tui/state.ts`
   - `src/tui/safe-poll.ts`
   - `src/tui/components/sidebar.tsx`
   - `src/tui/components/status-indicator.tsx`
   - `src/tui/components/dashboard.tsx`
   - `src/tui/components/priority-screen.tsx`
   - `src/core/usage/selection.ts` and `src/core/usage/percent.ts`
   - `src/server/request-balancer.ts` (only to confirm what data shapes the TUI needs,
     do not modify)
   - `package.json` (confirm Bun version, module resolution / `type: module`, existing
     `Worker` usage if any, build tooling — e.g. esbuild/bun build config — to confirm
     how a worker entry file needs to be referenced so it survives bundling)
2. Confirm the **exact shape** of data each polling component currently reads (field
   names, types) — do not assume the field names used as examples in this plan
   (`accounts`, `usagePercent`, etc.) are correct. Use the real shapes.
3. Confirm whether `PRAGMA journal_mode = WAL` is already set anywhere in
   `database.ts`. If not present, add it (see Step 1). If present, skip that sub-step.
4. Confirm how `bun run build` bundles the project (single bundle vs multi-entry) and
   how a `new Worker(new URL(...))` or `new Worker("path.ts")` reference needs to be
   written so the worker file is included in `dist/` and resolvable at runtime. This is
   a common bundler pitfall — verify empirically by building and checking `dist/` for
   the worker file, not by assumption.

If any assumption in this plan conflicts with the real code, the real code wins —
adapt field/function names accordingly and note the deviation in the PR description.

---

## Architecture summary

```
┌─────────────────────────────┐        postMessage         ┌──────────────────────────┐
│   TUI main thread            │ <────────────────────────  │  db-worker.ts (Worker)   │
│                               │                             │                          │
│  state.ts (subscribes to     │  ─── control messages ───>  │  owns bun:sqlite conn    │
│    db-cache.ts)               │                             │  (WAL mode)              │
│                               │                             │                          │
│  sidebar.tsx                 │                             │  setInterval poll loop   │
│  status-indicator.tsx        │                             │  (~1000ms, tunable)      │
│  dashboard.tsx                │                             │                          │
│  priority-screen.tsx         │                             │  diff vs last snapshot   │
│    (all read from cache,      │                             │  wrapped in try/catch    │
│     zero direct SQLite calls) │                             │  (reuses safePoll shape) │
└─────────────────────────────┘                             └──────────────────────────┘
```

The **server process** is unchanged and out of frame here — it remains a separate OS
process with its own SQLite connection, as before.

---

## Step 1 — Enable WAL mode (independent, do first, low risk)

**File:** `src/core/database.ts`

Add (if not already present), immediately after opening the database connection and
before/alongside the existing `busy_timeout` pragma:

```ts
db.exec("PRAGMA journal_mode = WAL;");
```

Rationale: WAL mode allows readers to proceed concurrently with a writer in the common
case, reducing lock collisions between the server's writes and the TUI worker's reads
even before the threading fix lands. This is a low-risk, high-value independent change.

**Verify:** confirm the pragma actually takes effect by querying
`PRAGMA journal_mode;` after `db.exec(...)` in a quick manual check or in a new test
assertion (see Testing section).

**Note:** if `database.ts` is used by both the server process and the TUI process (i.e.
it's the shared connection-opening module), this single change covers both. If TUI and
server have separate connection-opening code paths, apply the pragma in both.

---

## Step 2 — Define the message protocol (shared types)

**New file:** `src/tui/db-worker-protocol.ts`

Purpose: single source of truth for the shape of messages passed between the worker and
the main thread, imported by both `db-worker.ts` and `db-cache.ts`. Keeping this in a
separate file avoids duplicating type definitions and avoids accidental drift.

```ts
// src/tui/db-worker-protocol.ts

// Replace `TuiSnapshot` fields below with the REAL fields currently read by
// sidebar.tsx / status-indicator.tsx / dashboard.tsx / priority-screen.tsx.
// This is a placeholder shape based on the session summary's description of
// "accounts, usage-quota percentages, cooldown/health state" — confirm against
// real code before implementing.
export interface TuiSnapshot {
  accounts: Array<{
    alias: string;
    provider: string;
    healthy: boolean;
    disabled: boolean;
    cooldownUntil: number | null; // epoch ms, null if not in cooldown
    usagePercentRemaining: number | null; // null = no usage data available
    active: boolean; // currently selected/sticky account
  }>;
  quotaAwareSelectionEnabled: boolean;
  // add any additional fields actually read by dashboard.tsx / priority-screen.tsx
  // (e.g. request counts, last-rotation timestamp, priority list order) — confirm
  // against real source before finalizing.
}

// Messages FROM worker TO main thread
export type WorkerToMainMessage =
  | { type: "snapshot"; data: TuiSnapshot; timestamp: number }
  | { type: "error"; message: string; timestamp: number }
  | { type: "heartbeat"; timestamp: number };

// Messages FROM main thread TO worker (control only — worker owns polling cadence)
export type MainToWorkerMessage =
  | { type: "start" }
  | { type: "stop" }
  | { type: "force-refresh" }; // e.g. user manually triggers a refresh action in TUI
```

Design notes:
- `snapshot` messages are only sent when the worker's internal diff detects a change
  (see Step 3) — not on every poll tick. This avoids needless main-thread re-renders.
- `heartbeat` messages are sent unconditionally on every poll tick (whether or not data
  changed) so the main thread can detect a dead/stuck worker (see Step 4, staleness
  detection). This is intentionally separate from `snapshot` so heartbeat cadence isn't
  affected by whether the underlying data happens to be static.
- `error` messages let the worker report a caught exception without crashing, mirroring
  what `safe-poll.ts` already does on the main thread today.

---

## Step 3 — Implement the worker

**New file:** `src/tui/db-worker.ts`

Responsibilities:
- Runs as a `Worker` (Bun supports the standard `Worker` API — confirm import style,
  e.g. `import { parentPort } from "worker_threads"` vs Bun's own worker global —
  against actual `package.json`/Bun version during implementation).
- Opens its OWN `bun:sqlite` connection to the same database file path used by
  `database.ts` (do not share a connection object across threads — each thread needs
  its own connection; this matches the existing server/TUI process separation pattern).
- Sets `PRAGMA journal_mode = WAL;` and the existing `busy_timeout = 500` on this
  connection too, matching Step 1 and the existing `database.ts` value.
- On `"start"` message: begin a `setInterval` poll loop (default 1000ms — tunable
  constant `POLL_INTERVAL_MS` at top of file, easy to tune later without touching logic).
- On `"stop"` message: `clearInterval` and keep the connection open but idle (or close
  it — decide based on whether `stop` implies the worker will be re-started; if unsure,
  keep connection open, only stop the timer).
- On `"force-refresh"` message: run one poll iteration immediately, outside the regular
  interval, without resetting the interval timer.
- Each poll iteration:
  1. Wrapped in try/catch (equivalent to what `safe-poll.ts` does today, reused
     conceptually — see note below on whether to literally import `safe-poll.ts` or
     re-implement the pattern inside the worker file).
  2. Reads whatever `sidebar.tsx` / `status-indicator.tsx` / `dashboard.tsx` /
     `priority-screen.tsx` currently read via their own individual polling — consolidate
     into ONE read (or a small number of reads) that produces the full `TuiSnapshot`.
  3. Deep-compares (or shallow-compares by relevant fields — cheap deterministic
     comparison, e.g. `JSON.stringify` equality is acceptable given snapshot size is
     small; avoid pulling in a diffing library for this) the new snapshot against the
     last snapshot sent.
  4. If different (or if this is the first poll), `postMessage({ type: "snapshot", ... })`
     and store the new snapshot as "last sent."
  5. Always `postMessage({ type: "heartbeat", timestamp: Date.now() })`, regardless of
     whether the snapshot changed.
  6. On caught error: `postMessage({ type: "error", message: String(err), timestamp })`
     and continue the loop (do not let one bad tick stop future ticks — same philosophy
     as `safePoll()`).

On `safe-poll.ts` reuse: if `safePoll()` is currently written assuming it wraps a
callback invoked via `setInterval` on the *main* thread specifically (e.g. it references
main-thread-only APIs like toast notifications), it will need a small adaptation to be
usable inside a worker (workers cannot directly call TUI toast APIs). Two acceptable
options, decide based on what's simpler given the real code:
  (a) Import and reuse `safePoll()`'s error-catching logic as-is if it's toolkit-agnostic,
      or
  (b) Re-implement the same try/catch-and-continue shape inline in `db-worker.ts` and
      leave `safe-poll.ts` untouched, used only where it already is (main-thread
      contexts, if any remain — likely none after this change removes main-thread
      polling entirely, in which case check whether `safe-poll.ts` becomes dead code and
      flag that in the PR rather than silently deleting it).

**Worker crash / uncaught exception outside the try/catch:** add a top-level
`process.on("uncaughtException", ...)` (or Bun worker equivalent) inside the worker file
that posts an `"error"` message before the worker potentially dies, so the main thread
at least gets one diagnostic message instead of silent death. This is a safety net on
top of the per-tick try/catch, not a replacement for it.

---

## Step 4 — Implement the main-thread cache

**New file:** `src/tui/db-cache.ts`

Responsibilities:
- Spawns the worker (module path resolution must match whatever Step 3's prerequisite
  check determined about how `bun run build` bundles worker entry points — verify this
  works in a built `dist/` output, not just in dev mode, before considering this step
  done).
- Sends `{ type: "start" }` immediately after spawn.
- Holds the in-memory cache: `let cache: TuiSnapshot | null = null;` plus
  `let lastHeartbeatAt: number | null = null;` plus `let isStale: boolean = false;`.
- `worker.onmessage` (or Bun equivalent event API) handler:
  - `"snapshot"` → update `cache`, set `isStale = false`, notify subscribers.
  - `"heartbeat"` → update `lastHeartbeatAt`, and if `isStale` was true, clear it and
    notify subscribers (worker recovered).
  - `"error"` → log it (to wherever the app currently logs worker/background errors —
    confirm the real logging mechanism during implementation; do not introduce a new
    logging pathway if one already exists) but do NOT mark cache stale on a single error
    — only the heartbeat timeout (below) marks staleness, since one error doesn't mean
    the worker died.
- **Staleness / dead-worker detection:** a separate `setInterval` on the main thread
  (lightweight, non-blocking — just a `Date.now()` comparison, NOT a SQLite call) checks
  every ~5000ms whether `lastHeartbeatAt` is older than e.g. 3x `POLL_INTERVAL_MS`
  (~3000ms at default settings). If so, set `isStale = true` and notify subscribers, so
  the UI can show a "data may be stale" indicator rather than silently showing frozen
  data with no explanation. This check is cheap enough that running it on the main
  thread is safe — it does not touch SQLite.
- `worker.onerror` handler (distinct from the `"error"` message type — this catches the
  worker thread itself crashing, not an in-worker caught exception): mark stale
  immediately, log, and optionally attempt one automatic respawn (`terminate()` +
  re-spawn + re-send `"start"`) with a basic guard against respawn loops (e.g. max 3
  respawns per session, or a cooldown between respawn attempts) — decide the exact
  policy during implementation and document it in code comments; don't over-engineer
  this initially, a single respawn attempt with a logged failure if it recurs is
  sufficient for v1.
- Exposes a simple subscribe API matching whatever pattern `state.ts` already uses for
  reactive state (confirm during implementation — if it's a plain event emitter, a
  signal/store pattern, or something framework-specific, match it rather than
  introducing a new pattern):
  ```ts
  export function getSnapshot(): TuiSnapshot | null;
  export function isSnapshotStale(): boolean;
  export function subscribe(callback: () => void): () => void; // returns unsubscribe
  export function forceRefresh(): void; // posts "force-refresh" to worker
  export function shutdown(): void; // posts "stop", terminates worker — call on TUI exit
  ```
- **Shutdown hook:** ensure `shutdown()` is called when the TUI process exits (wherever
  the app currently handles process exit / cleanup — confirm the real exit path, e.g.
  a `process.on("exit", ...)` or an existing cleanup function) so the worker thread
  doesn't leak past TUI shutdown.

---

## Step 5 — Wire `state.ts` to the cache

**File:** `src/tui/state.ts`

- Remove any direct `bun:sqlite` polling currently in this file.
- Import and call `subscribe()` from `db-cache.ts`; on each notification, pull
  `getSnapshot()` / `isSnapshotStale()` and update whatever reactive state primitive
  `state.ts` exposes to the rest of the TUI (match existing patterns — do not change the
  public interface of `state.ts` that other components consume unless necessary).
- This becomes the ONLY file, besides `db-worker.ts` itself, that touches the cache
  module directly. Components should keep reading through `state.ts` as they already do
  today (confirm this is in fact how components currently consume state — if components
  instead import SQLite/query functions directly rather than going through `state.ts`,
  this step needs to change those import sites too — see Step 6).

---

## Step 6 — Strip polling out of the four component files

**Files:** `src/tui/components/sidebar.tsx`, `src/tui/components/status-indicator.tsx`,
`src/tui/components/dashboard.tsx`, `src/tui/components/priority-screen.tsx`

For each file:
- Remove the component-local `setInterval` and any direct SQLite read call.
- Remove any component-local usage of `safePoll()` (since polling no longer happens
  here).
- Replace with reading from `state.ts`'s existing reactive state (the same way these
  components presumably already consume other pieces of shared state, if any — match
  existing conventions in the file).
- If any of these components currently read fields that are NOT yet included in the
  `TuiSnapshot` type from Step 2, add those fields to `TuiSnapshot` and to the worker's
  read query in Step 3 before removing the component's local read — do this file by file,
  don't remove local reads until the replacement data path is confirmed to carry
  equivalent data.
- `dashboard.tsx` specifically also owns the "Prefer highest-quota account: ON/OFF"
  toggle row (`quota_aware_selection_enabled`) — confirm this toggle's read AND write
  paths. Reads should now come from the cache/`state.ts`. Writes (toggling the setting)
  still go through the existing `setQuotaAwareSelectionEnabled` write path — writes are
  NOT part of this refactor and should be left as direct calls (writes are infrequent,
  user-initiated, and not part of the polling-freeze problem). After a write, call
  `forceRefresh()` from `db-cache.ts` so the toggle's new state reflects immediately
  rather than waiting for the next poll tick.
- `priority-screen.tsx` likely has similar write paths for reordering priority — same
  treatment: writes stay direct, call `forceRefresh()` after a write, reads come from
  cache.

---

## Step 7 — Confirm nothing else touches SQLite from the main thread

Search the TUI-side codebase (`src/tui/**`, excluding `db-worker.ts`) for any remaining
`bun:sqlite` imports or direct database calls after Steps 5–6 are complete. There should
be none. If any are found (e.g. a one-off read in a dialog or less-obvious component not
listed in the session summary), route it through the same cache/subscribe pattern rather
than leaving a straggler direct read.

---

## Testing plan

New test files:

- **`test/tui/db-worker.test.ts`**
  - Diffing logic: given two snapshots that differ, confirm a `"snapshot"` message
    would be produced; given two identical snapshots, confirm none would be produced
    (test the diff function directly if extracted as a pure function — recommended:
    extract `snapshotsEqual(a, b)` as an exported pure function from `db-worker.ts`
    specifically so it's unit-testable without spinning up a real `Worker` in the test
    runner).
  - Error handling: simulate a thrown error during a poll tick, confirm an `"error"`
    message shape is produced and the loop is documented/designed to continue (test the
    per-tick handler function in isolation if extracted as a pure-ish function, rather
    than testing the live `setInterval` timing).
  - WAL pragma: confirm the worker's connection setup calls
    `PRAGMA journal_mode = WAL` (can assert on the SQL string passed to `db.exec` if the
    test can intercept/mock that call).

- **`test/tui/db-cache.test.ts`**
  - Message handling: feed simulated `WorkerToMainMessage` values into the cache's
    message handler (extract it as a testable function taking a message and returning/
    mutating cache state, rather than requiring a real worker in tests) and assert
    `getSnapshot()` / `isSnapshotStale()` update correctly for `"snapshot"`,
    `"heartbeat"`, and `"error"` cases.
  - Staleness detection: simulate time passing without a heartbeat (mock `Date.now()`
    or inject a clock) and confirm `isSnapshotStale()` flips to true after the threshold,
    and back to false once a fresh heartbeat/snapshot arrives.
  - Subscribe/unsubscribe: confirm subscribers are notified on relevant messages and NOT
    notified spuriously (e.g. a `"heartbeat"` that doesn't change staleness state
    shouldn't necessarily fire a notify if that would cause needless re-renders — decide
    based on what `state.ts`'s reactive primitive expects, and test that behavior
    explicitly either way).

- **Update `test/core/schema.test.ts`** (already touched in the prior session per the
  summary) if WAL mode changes any schema-level assumptions being tested — confirm no
  regression, don't assume it's unaffected.

- **Existing tests that must still pass unmodified:** anything under
  `test/server/**`, `test/core/priority.test.ts`, `test/core/usage-selection.test.ts` —
  none of this plan touches server-side or core selection logic, so these should be
  unaffected. Running them is still required as a regression check.

- **Manual verification** (cannot be automated in this environment, must be done by a
  human or a longer-running interactive test harness):
  - Start the balancer with the server under simulated load (rapid requests triggering
    rotations/writes) and type continuously in the TUI; confirm no perceptible input
    stall, including during an active rotation/failover event.
  - Kill/crash the worker deliberately (e.g. throw synchronously outside the try/catch
    to test the `onerror` path) and confirm the TUI shows a stale-data indicator rather
    than silently freezing or crashing the whole TUI process.
  - Toggle "Prefer highest-quota account" and confirm the dashboard reflects the change
    promptly (via `forceRefresh()`) rather than waiting up to a full poll interval.

---

## Verification pipeline (unchanged from existing project convention)

Run after every step, not just at the end:

1. `bun run checktypes`
2. `bun run lint` / `bun run lint:fix`
3. `bun test`
4. `bun run build`, then `grep` the compiled `dist/*.js` output to confirm:
   - `db-worker.ts`'s compiled output is actually present in `dist/` (see prerequisite
     check on bundler worker-entry handling — this is the step most likely to silently
     fail if worker bundling isn't configured correctly)
   - The WAL pragma string appears in the compiled output
   - No remaining direct `bun:sqlite` import inside compiled TUI component output files

Target: all existing 263 tests continue to pass, plus new tests for `db-worker.ts` and
`db-cache.ts`, with a clean build that verifiably includes the worker file.

---

## Order of implementation

1. Step 1 (WAL mode) — independent, ship/test first, low risk.
2. Step 2 (protocol types) — no behavior change, just types.
3. Step 3 (worker) — build and unit-test in isolation (via extracted pure functions)
   before wiring anything else to it.
4. Step 4 (cache) — build and unit-test against simulated messages before spawning a
   real worker.
5. Confirm worker + cache work together in a minimal manual smoke test (spawn worker,
   confirm at least one real `"snapshot"` and one `"heartbeat"` message arrive) before
   touching any existing component.
6. Step 5 (`state.ts` wiring).
7. Step 6 (strip component polling) — do ONE component first (suggest
   `status-indicator.tsx`, likely the simplest), verify manually, then proceed to the
   remaining three.
8. Step 7 (sweep for stragglers).
9. Full test suite + build + manual verification pass.

---

## Rollback safety

Each step should be a separate commit. Steps 5–6 (wiring components to the new cache)
are the highest-risk steps for regressions in what the TUI displays — if anything looks
wrong after Step 6, it's safe to revert just that component's commit and leave it on its
old direct-polling behavior temporarily while `db-worker.ts`/`db-cache.ts` remain in
place for the already-migrated components. The old per-component polling code should
therefore NOT be deleted until each component's migration is individually confirmed
working — comment it out or delete component-by-component in its own commit, not in one
large sweep, specifically to make this kind of partial rollback possible.
