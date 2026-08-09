# @secondstrikerss/opencode-balancer

## 2.0.1

### Patch Changes

- 862cb74: Fix the Balancer dashboard list not scrolling when the cursor moves past the bottom of the viewport. The `scrollbox` now keeps the selected row in view via `scrollChildIntoView`, following the cursor on keyboard navigation, mouse clicks, and cursor clamping after removes or refreshes.
- 28483e7: Read the balancer-bar and selected-provider state from the worker-fed cache snapshot instead of running live `bun:sqlite` queries on the main thread. These closures render on every `session_prompt_right` tick (including mid-stream), so this removes the heaviest query in the codebase from the per-render path.

## 2.0.0

### Major Changes

- 5ec6178: Move all TUI-side SQLite polling into a dedicated Worker thread with a consolidated in-memory cache. The main thread never calls `bun:sqlite` directly anymore; components read from the cache, which is updated only via `postMessage` from the worker. This makes it structurally impossible for a slow or locked SQLite read to stall keyboard input and rendering.
- a54cd63: Complete the worker migration and attach it: `db-worker.ts` is a build entrypoint that polls on its own thread, `snapshot.ts` holds the shared pure read, `db-cache.ts` manages the worker lifecycle and staleness detection, and the dashboard, priority screen, sidebar, and status indicator read their data from the cache.
- d3858ce: Rewrite INSTALL.txt to install the local checkout via a `file://` URL instead of the npm registry. The installer locates a directory whose `package.json` names `@secondstrikerss/opencode-balancer`, verifies `dist/index.js` and `dist/tui/tui.js` are current, and forbids npm/bun/pnpm install and any npm package entries. This is a breaking change for users following the previous npm-based instructions.

### Patch Changes

- 8dcd520: Retry HTTP 502 responses with another healthy account, optimize the account-changing mechanism, and fix the TUI freezing while an account rotation happens.
- 2ec4e21: Detect quota-exceeded responses by inspecting the response body in addition to status codes, so providers that signal exhaustion with a 200 + limit message are handled too.

## 0.2.18

### Patch Changes

- 3535f76: Read auth.json from the same directory opencode writes it on Windows (`~/.local/share/opencode`, matching xdg-basedir) instead of `%LOCALAPPDATA%`, so accounts connected through the native provider flow are saved.

## 0.2.17

### Patch Changes

- 293877b: Fix arrow-key navigation in the dashboard and priority screens when the plugin is installed from npm. opencode's route computation could track the screens' selection signals through opentui's runtime bridge, remounting the screen on every key press and resetting the selection; the selection state now lives at module scope so it survives those remounts.

## 0.2.16

### Patch Changes

- d4cd624: Upgrade @opentui/solid to 0.4 so TUI components resolve a real jsx-runtime module when the plugin is installed from npm; 0.2 only shipped jsx-runtime.d.ts, which crashed activation with "Export named 'jsxDEV' not found" whenever the plugin lived under node_modules.

## 0.2.15

### Patch Changes

- 766f207: Skip schema table recreation when the migration is already applied, fixing "database is locked" and "no such table: accounts_new" races between concurrent server and TUI plugin instances.

## 0.2.14

### Patch Changes

- 0e4aabd: Restore Balancer TUI command registration for opencode builds that use the command API.

## 0.2.13

### Patch Changes

- 3d90b41: Register the Balancer dashboard command through OpenCode's current TUI keymap API so `/balancer`, `Ctrl+B`, and the command palette work on OpenCode 1.17.18.

## 0.2.12

### Patch Changes

- 7e29ed3: Fix the Balancer TUI on OpenCode 1.17.18:

  - Register the dashboard command through OpenCode's TUI command shim (`api.command.register`) when available so `/balancer`, `Ctrl+B`, and the "Open Balancer Dashboard" palette entry appear again, keeping the keymap layer as a fallback for newer runtimes.
  - Fix dashboard arrow-key navigation resetting the selection every ~500ms: the dashboard poll re-set its `accounts` and `usage` signals with fresh identities on every tick, which made OpenCode re-render (remount) the route and reset the cursor. The poll now only updates those signals when the underlying data actually changed.
  - Fix the selected-row highlight being invisible on themes with a transparent `backgroundElement`. The selection now uses the theme's `primary` color with an opencode-style selected foreground, matching how opencode highlights its own list selections.
  - Fix the dashboard appearing frozen after adding an account: opencode opens (and briefly keeps re-opening) its native model picker on top of the dashboard after a provider connects, capturing the keyboard until the user pressed Esc. The connect flow now dismisses that lingering picker so control returns to the dashboard automatically.
  - Use Windows-specific environment fallbacks (`USERPROFILE`, `HOMEDRIVE`/`HOMEPATH`, `LOCALAPPDATA`) when resolving the config and data directories so the plugin initializes on Windows.

## 0.2.11

### Patch Changes

- aa105ac: Fix the balancer dashboard crashing with "No renderer found". The TUI components are now shipped as source so opencode's runtime plugin transforms them at load time and they share opencode's `@opentui/solid` renderer context, while the entrypoint stays compiled so the plugin still initializes.

## 0.2.10

### Patch Changes

- 3189ae3: Export the compiled TUI entrypoint so current opencode versions can initialize the dashboard plugin.

## 0.2.9

### Patch Changes

- e4b36ea: Dummy patch release to verify the startup auto-update end to end.

## 0.2.8

### Patch Changes

- a6beec6: Fix the plugin auto-update never running. The check now runs when the plugin
  loads, on every opencode start. Detecting a newer release clears the stale
  cached `@latest` sandbox and opencode reinstalls the new version on its own,
  with no toast or restart prompt.

## 0.2.7

### Patch Changes

- 7538af1: Publish another dummy patch release to test deferred plugin cache auto-update behavior.

## 0.2.6

### Patch Changes

- 4f43755: Run the plugin cache update check after the first root session is created, matching the deferred startup pattern used by other opencode plugins.

## 0.2.5

### Patch Changes

- e483c2d: Publish a dummy patch release to test plugin cache auto-update behavior.

## 0.2.4

### Patch Changes

- 809fdf6: Invalidate only the active outdated `@latest` opencode plugin cache sandbox after detecting a newer npm release, then notify the user to restart opencode.

## 0.2.3

### Patch Changes

- 752d8e9: Show the plugin version in the dashboard title.

## 0.2.2

### Patch Changes

- a3b2716: Mitigate intermittent SQLite lock failures by configuring a connection-level busy timeout during database initialization.

## 0.2.1

### Patch Changes

- 2843fae: Document plugin installation instructions using the unversioned package entry instead of `@latest`.

## 0.2.0

### Minor Changes

- c83caf5: Add the new TUI-driven balancer workflow.

  This release replaces the legacy command-centric balancer with a dedicated opencode TUI dashboard and server/core architecture for managing multiple accounts, provider/model priority, and automatic failover.

  - Add a Balancer dashboard available from `Ctrl+B`, `/balancer`, the command palette, and the sidebar.
  - Add account management from the TUI, including native provider connection, account activation, rename/remove flows, duplicate-account refresh, and selected-account status syncing.
  - Add a provider priority matrix for enabling balancing, choosing one model per provider, reordering failover priority, and disabling providers from automatic routing.
  - Add automatic retry/failover for retryable provider responses, marking rate-limited accounts temporarily unhealthy and switching to another healthy saved account when available.
  - Add local SQLite-backed storage for accounts, provider state, pending native connections, usage snapshots, priority settings, and balancer events.
  - Add usage snapshot support for supported providers and display usage in the dashboard/sidebar status surfaces.
  - Update packaging and docs for the TUI plugin entry point, Bun lockfile workflow, Changesets-based releases, and the new installation/setup guide.
