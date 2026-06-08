<div align="center">

# opencode-balancer

_Use multiple accounts and provider/model priorities in opencode, then fail over automatically when one account hits a limit._

[![npm version](https://img.shields.io/npm/v/@thelioo/opencode-balancer?style=flat-square)](https://www.npmjs.com/package/@thelioo/opencode-balancer)
[![TypeScript](https://img.shields.io/badge/TypeScript-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![opencode plugin](https://img.shields.io/badge/opencode-plugin-111?style=flat-square)](https://opencode.ai/docs/plugins)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

[Features](#features) | [Installation](#installation) | [Usage](#usage) | [Troubleshooting](#troubleshooting)

</div>

`opencode-balancer` is an [opencode](https://opencode.ai/) server and TUI plugin that lets you keep several authenticated accounts, choose which provider/model should be used first, and keep working when the current account becomes rate-limited.

It integrates with opencode's native provider connection flow. Use the plugin dashboard to connect accounts, inspect usage, switch active accounts, configure provider priority, and enable or disable automatic balancing.

> [!NOTE]
> This plugin manages credentials already configured through opencode. It does not create accounts, bypass provider limits, or modify provider-side quotas.

## Features

- **Multiple accounts per provider**: Save and activate separate accounts for the same provider.
- **Automatic failover**: Retries with another healthy account after retryable responses such as `429`, `500`, `502`, `503`, `504`, or `529`.
- **Provider priority matrix**: Choose one model per provider, reorder failover priority, and disable providers from the balancer.
- **TUI dashboard**: Open a control center from the command palette, `/balancer`, `Ctrl+B`, or the sidebar.
- **Native connect flow**: Start opencode's provider connection from the dashboard and save the detected account automatically.
- **Usage snapshots**: Shows per-account usage when the provider exposes supported usage data.
- **Local credential store**: Saves accounts, usage snapshots, events, and priority settings under your opencode config directory.

## Installation

### Option A: Let an AI Agent Install It

Paste this into opencode or another coding agent running on your machine:

```text
Install and configure @thelioo/opencode-balancer by following this guide:
https://raw.githubusercontent.com/thelioo/opencode-balancer/refs/heads/main/INSTALL.txt
```

Or read the local guide: [INSTALL.txt](INSTALL.txt).

### Option B: Manual Setup

Add the plugin to your opencode config so the server hooks can run:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@thelioo/opencode-balancer"]
}
```

Then add the same plugin to your opencode TUI config so the dashboard can load:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["@thelioo/opencode-balancer"]
}
```

Use the package name without an explicit `@latest` tag so opencode can refresh to newer published versions on restart.

Then restart opencode. The same package provides both the server hooks and the TUI dashboard.

> [!TIP]
> No manual `npm install` is required. opencode installs npm plugins automatically with Bun at startup and caches them locally.

## Usage

### Open The Dashboard

Open the Balancer dashboard with any of these entry points:

- Press `Ctrl+B`.
- Run `/balancer` from opencode to open the dashboard.
- Open **Open Balancer Dashboard** from the command palette.
- Click the Balancer dashboard button in the sidebar.

The dashboard is the primary workflow for account management. It works on compact and full terminal layouts.

### Connect An Account

In the dashboard, choose **New account** or press `C`. The plugin opens opencode's native provider connection flow.

After the provider auth changes, `opencode-balancer` detects the new credentials and saves them as an account. If the credentials match an existing saved account, the saved account is refreshed instead of duplicated.

### Manage Accounts

Use the dashboard and sidebar to:

- Activate an account for a provider.
- Rename an account.
- Remove an account after confirmation.
- View supported usage snapshots when the provider exposes compatible usage data.

Aliases are normalized to lowercase and may contain letters, numbers, dots, hyphens, and underscores.

### Configure Automatic Balancing

Open the priority matrix from the dashboard header or press `P`.

In the priority matrix you can:

- Press `B` to enable or disable automatic balancing.
- Pick the model used for each provider with `Enter`.
- Reorder providers with `Shift+Up` and `Shift+Down`.
- Enable or disable individual providers with `Space`.

When balancing is on, the priority matrix decides the provider/model for each message. The plugin selects the first enabled provider with a configured model and a healthy saved account. When a retryable error is returned, the current account is temporarily marked as rate-limited and another healthy account for that provider is used when available.

When balancing is off, opencode keeps its native provider/model selection. The plugin only applies the selected saved account when needed.

## TUI Entry Points

`opencode-balancer` is managed from the TUI. Use one of these entry points to open the dashboard:

- `Ctrl+B`
- `/balancer`
- **Open Balancer Dashboard** in the command palette
- The Balancer sidebar button

## How It Works

`opencode-balancer` combines server hooks with a TUI module:

1. The TUI dashboard opens opencode's native connect flow and stores changed provider credentials as saved accounts.
2. The dashboard stores selected accounts, per-provider models, balancing state, usage snapshots, and priority order in a local SQLite database.
3. Before a chat request, server hooks choose the active account and, when balancing is enabled, the provider/model from the priority matrix.
4. A fetch patch injects the selected account credentials into the provider request.
5. Retryable provider responses mark the account as temporarily rate-limited and trigger a retry with another healthy account when balancing is enabled.

Saved account data is written to:

```text
~/.config/opencode/balancer.sqlite
```

If `OPENCODE_CONFIG_DIR` is set, the plugin uses that directory instead.

> [!CAUTION]
> The account store contains credentials. Keep it private and do not commit it to a repository.

## Local Development

```bash
bun install
bun run check
bun run build
bun test
```

Releases use Changesets:

```bash
bun run changeset
bun run version
bun run release
```

To test a local checkout with opencode, point your opencode config to the package directory:

```json
{
  "plugin": ["file:///absolute/path/to/opencode-balancer"]
}
```

And add the same local path to your TUI config:

```json
{
  "plugin": ["file:///absolute/path/to/opencode-balancer"]
}
```

## Troubleshooting

| Problem | What to try |
| --- | --- |
| Plugin does not load | Confirm `plugin` is singular in opencode config, restart opencode, and check that the package name is `@thelioo/opencode-balancer`. |
| Dashboard does not open | Confirm `tui.json` also contains the plugin, restart opencode, then try `Ctrl+B`, `/balancer`, or the command palette. |
| Account was not saved | Use **New account** from the Balancer dashboard and complete opencode's native provider connection flow. |
| Provider is skipped | Open the priority matrix and confirm the provider is enabled and has a model selected. |
| Account is not switching | Confirm there is another non-disabled saved account for the same provider and automatic balancing is on. |

## Resources

- [opencode plugins documentation](https://opencode.ai/docs/plugins)
- [opencode configuration](https://opencode.ai/docs/config)
- [npm package](https://www.npmjs.com/package/@thelioo/opencode-balancer)
