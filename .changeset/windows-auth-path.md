---
"@thelioo/opencode-balancer": patch
---

Read auth.json from the same directory opencode writes it on Windows (`~/.local/share/opencode`, matching xdg-basedir) instead of `%LOCALAPPDATA%`, so accounts connected through the native provider flow are saved.
