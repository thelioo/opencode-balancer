# @thelioo/opencode-balancer

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
