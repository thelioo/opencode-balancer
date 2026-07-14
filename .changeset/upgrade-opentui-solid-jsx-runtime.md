---
"@thelioo/opencode-balancer": patch
---

Upgrade @opentui/solid to 0.4 so TUI components resolve a real jsx-runtime module when the plugin is installed from npm; 0.2 only shipped jsx-runtime.d.ts, which crashed activation with "Export named 'jsxDEV' not found" whenever the plugin lived under node_modules.
