# Plan: Install opencode-balancer as a global local plugin

## Context

The `opencode-balancer` workspace plugin is a local checkout registered into opencode via
the `file://` path. The install was already partially present but redundant. Goal: a single,
global, local-file install; remove the duplicate npm `@secondstrikerss/opencode-balancer`
registration without swapping the plugin.

## Current state (found during investigation)

- Global server config `~/.config/opencode/opencode.json:3`
  → `plugin: ["file:///home/mohsen/.../opencode-balancer"]` (local path) ✅
- Global duplicate `~/.config/opencode/opencode.jsonc:3`
  → `plugin: ["@secondstrikerss/opencode-balancer"]` (npm package; opencode deep-merges
  both `opencode.json` and `opencode.jsonc`, so this double-registers) ❌ remove
- Global TUI config `~/.config/opencode/tui.json:3`
  → `plugin: ["@secondstrikerss/opencode-balancer"]` (npm package — should be local path) ❌ fix
- Workspace `opencode-balancer/opencode.json` + `tui.json` → local `file://` path (redundant
  now, harmless; left in place)

## Steps

1. Backup anything changed in `~/.config/opencode/`:
   - `tui.json` → `tui.json.backup-<timestamp>`
   - `opencode.jsonc` → `opencode.jsonc.backup-<timestamp>`
2. `~/.config/opencode/tui.json`: change plugin to
   `"file:///home/mohsen/AIProjects/secondstrikerss-opencode-balancer/opencode-balancer"`.
3. Remove redundant `~/.config/opencode/opencode.jsonc` (npm dup; backup first).
4. Leave unchanged: global `opencode.json` (already local), workspace `opencode.json`/`tui.json`.
5. Verify final plugin arrays on `opencode.json` and `tui.json`.
6. Restart opencode required (config not hot-reloaded).

## Verification

- `~/.config/opencode/opencode.json` has only the local `file://` plugin entry.
- `~/.config/opencode/tui.json` has only the local `file://` plugin entry.
- No plugin removed from active config (same local plugin, just deduplicated).
- Confirm `dist/` build exists for the workspace path.
