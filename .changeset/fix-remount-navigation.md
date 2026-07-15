---
"@thelioo/opencode-balancer": patch
---

Fix arrow-key navigation in the dashboard and priority screens when the plugin is installed from npm. opencode's route computation could track the screens' selection signals through opentui's runtime bridge, remounting the screen on every key press and resetting the selection; the selection state now lives at module scope so it survives those remounts.
