---
"@thelioo/opencode-balancer": patch
---

Skip schema table recreation when the migration is already applied, fixing "database is locked" and "no such table: accounts_new" races between concurrent server and TUI plugin instances.
