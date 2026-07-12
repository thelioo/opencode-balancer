---
"@thelioo/opencode-balancer": patch
---

Fix the Balancer TUI on OpenCode 1.17.18:

- Register the dashboard command through OpenCode's TUI command shim (`api.command.register`) when available so `/balancer`, `Ctrl+B`, and the "Open Balancer Dashboard" palette entry appear again, keeping the keymap layer as a fallback for newer runtimes.
- Fix dashboard arrow-key navigation resetting the selection every ~500ms: the dashboard poll re-set its `accounts` and `usage` signals with fresh identities on every tick, which made OpenCode re-render (remount) the route and reset the cursor. The poll now only updates those signals when the underlying data actually changed.
- Fix the selected-row highlight being invisible on themes with a transparent `backgroundElement`. The selection now uses the theme's `primary` color with an opencode-style selected foreground, matching how opencode highlights its own list selections.
- Fix the dashboard appearing frozen after adding an account: opencode opens (and briefly keeps re-opening) its native model picker on top of the dashboard after a provider connects, capturing the keyboard until the user pressed Esc. The connect flow now dismisses that lingering picker so control returns to the dashboard automatically.
- Use Windows-specific environment fallbacks (`USERPROFILE`, `HOMEDRIVE`/`HOMEPATH`, `LOCALAPPDATA`) when resolving the config and data directories so the plugin initializes on Windows.
