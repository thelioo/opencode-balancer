---
"@thelioo/opencode-balancer": patch
---

Fix the balancer dashboard crashing with "No renderer found". The TUI components are now shipped as source so opencode's runtime plugin transforms them at load time and they share opencode's `@opentui/solid` renderer context, while the entrypoint stays compiled so the plugin still initializes.
