# @thelioo/opencode-balancer

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
