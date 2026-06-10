---
"@thelioo/opencode-balancer": patch
---

Fix the plugin auto-update never running. The check now runs when the plugin
loads, on every opencode start. Detecting a newer release clears the stale
cached `@latest` sandbox and opencode reinstalls the new version on its own,
with no toast or restart prompt.
