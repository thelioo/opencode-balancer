<div align="center">

# opencode-balancer

_Use multiple accounts per opencode provider and switch automatically when one hits a rate limit._

[![npm version](https://img.shields.io/npm/v/@thelioo/opencode-balancer?style=flat-square)](https://www.npmjs.com/package/@thelioo/opencode-balancer)
[![TypeScript](https://img.shields.io/badge/TypeScript-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![opencode plugin](https://img.shields.io/badge/opencode-plugin-111?style=flat-square)](https://opencode.ai/docs/plugins)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

[Features](#features) | [Installation](#installation) | [Usage](#usage) | [Fallback Commands](#fallback-commands) | [Troubleshooting](#troubleshooting)

</div>

`opencode-balancer` is an [opencode](https://opencode.ai/) plugin that lets you save multiple authenticated accounts for the same provider, give each one a friendly alias, and keep working when the active account becomes rate-limited.

It works with opencode's existing auth flow: connect a provider, save the detected credentials from the Balancer TUI, then let the plugin inject the active account credentials into future model requests.

> [!NOTE]
> This plugin manages credentials already configured through opencode. It does not create accounts, bypass provider limits, or modify provider-side quotas.

## Features

- **Multiple accounts per provider**: Save aliases like `work`, `personal`, or `backup` for the same provider.
- **Automatic failover**: Switches to another saved account on retryable rate-limit/server responses.
- **TUI-first account management**: Save aliases, switch accounts, and inspect pending connections from the Balancer sidebar/dashboard.
- **OAuth-friendly setup**: Uses opencode's native `/connect` flow, then prompts you to save the detected credentials in the TUI.
- **Agent tool support**: Exposes a `balancer_command` tool so opencode agents can manage accounts when asked.
- **Local credential store**: Saves account credentials and status data under your opencode config directory.

## Installation

### Option A: Let an AI Agent Install It

Paste this into opencode or another coding agent running on your machine:

```text
Install and configure @thelioo/opencode-balancer by following this guide:
https://raw.githubusercontent.com/thelioo/opencode-balancer/refs/heads/main/INSTALL.txt
```

Or read the local guide: [INSTALL.txt](INSTALL.txt).

### Option B: Manual Setup

Add the plugin to your opencode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@thelioo/opencode-balancer@latest"]
}
```

Then restart opencode.

> [!TIP]
> No manual `npm install` is required. opencode automatically installs npm plugins with Bun at startup and caches them locally.

## Usage

### Save Your First Account

Connect a provider with opencode's native flow:

```text
/connect anthropic
```

After the connection is detected, use the Balancer TUI modal or sidebar to save it with an alias such as `work`.

### Add Another Account

Connect the same provider with a different account, then save the new pending connection from the Balancer TUI:

```text
/connect anthropic
```

### Manage Accounts

Use the Balancer sidebar or dashboard to switch accounts, view usage, and review pending connections. If the dashboard is not visible, open it from opencode's command palette.

When the active account receives a retryable response such as `429`, `500`, `502`, `503`, `504`, or `529`, the plugin marks it as temporarily rate-limited and retries with another available account for the same provider.

## Fallback Commands

`opencode-balancer` is TUI-first. `/balancer` commands are compatibility and troubleshooting fallbacks, not the primary account management workflow. Alias creation is intentionally handled by the TUI pending-connection flow.

| Command | Description |
| --- | --- |
| `/balancer help` | Show fallback commands. |
| `/balancer list` | List saved accounts as `provider/alias`. |
| `/balancer status` | Show saved and pending counts. |
| `/balancer use <provider> <alias>` | Switch the active account for a provider. |
| `/balancer active <provider>` | Show the active account for a provider. |

Aliases are normalized to lowercase and may contain letters, numbers, dots, hyphens, and underscores.

## How It Works

`opencode-balancer` hooks into opencode's plugin lifecycle and request flow:

1. It watches opencode auth changes and records detected provider credentials as pending connections.
2. The Balancer TUI saves pending connections under provider-specific aliases.
3. Before model requests, the plugin selects the active account for the request provider.
4. If the provider returns a retryable rate-limit or server response, the plugin marks the account as temporarily unavailable and retries with another saved account.

Saved account data is written to:

```text
~/.config/opencode/balancer.sqlite
```

If `OPENCODE_CONFIG_DIR` is set, the plugin uses that directory instead.

> [!CAUTION]
> The account store contains credentials. Keep it private and do not commit it to a repository.

## Local Development

```bash
npm install
npm run check
npm run build
```

To test a local checkout with opencode, point your config to the package directory:

```json
{
  "plugin": ["file:///absolute/path/to/opencode-balancer"]
}
```

## Troubleshooting

| Problem | What to try |
| --- | --- |
| Plugin does not load | Confirm `plugin` is singular, restart opencode, and check that the package name is `@thelioo/opencode-balancer@latest`. |
| `/balancer` is unavailable | Restart opencode after editing the config. |
| No connection detected | Run `/connect <provider>` first, then save the pending connection from the Balancer TUI modal/sidebar. |
| Account is not switching | Open the Balancer sidebar/dashboard and confirm there is another saved account for the same provider. |
| Need command-line fallback | Run `/balancer help` for compatibility commands. |

## Resources

- [opencode plugins documentation](https://opencode.ai/docs/plugins)
- [opencode configuration](https://opencode.ai/docs/config)
- [npm package](https://www.npmjs.com/package/@thelioo/opencode-balancer)
