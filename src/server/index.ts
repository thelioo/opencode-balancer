import type { Database } from "bun:sqlite";
import {
	type Config,
	type Hooks,
	type Plugin,
	tool,
} from "@opencode-ai/plugin";
import packageJson from "../../package.json" with { type: "json" };
import {
	getActiveAccount,
	getSelectedAccount,
	getSelectedModel,
	setActiveAccount,
} from "../core/accounts";
import { openBalancerDatabase } from "../core/database";
import { storePath } from "../core/path";
import { getBalancingEnabled, resolveActiveSelection } from "../core/priority";
import { migrate } from "../core/schema";
import { checkAndInvalidateOutdatedPackageCache } from "./cache-update";
import { runFallbackBalancerCommand } from "./commands";
import { installFetchPatch } from "./fetch-patch";
import { setNativeAuth, showToast } from "./native";
import {
	BALANCER_METADATA_KEY,
	INTERNAL_REQUEST_HEADER,
	setPendingRequest,
} from "./request-balancer";

const PACKAGE_NAME = "@thelioo/opencode-balancer";

export function configureFallbackCommand(cfg: Config) {
	if (!cfg.command?.balancer) return;
}

function runSafeFallbackBalancerCommand(db: Database, raw: string) {
	try {
		return runFallbackBalancerCommand(db, raw);
	} catch (error) {
		return error instanceof Error ? error.message : "Balancer command failed.";
	}
}

export function createServerHooks({
	cacheUpdate,
	db,
	client,
}: {
	cacheUpdate?: () => Promise<unknown>;
	db: Database;
	client: any;
}): Hooks {
	// opencode caches the `@latest` sandbox and never re-resolves it, so the
	// bundled version goes stale after a release. Check on load; detecting a
	// newer release clears the stale sandbox so opencode reinstalls it.
	cacheUpdate?.().catch(() => {});

	return {
		"chat.headers": async (input, output) => {
			const providerID = input.model.providerID;
			const account = getActiveAccount(db, providerID);
			if (!account) return;

			if (account.auth.type === "oauth") {
				await setNativeAuth(client, providerID, account.auth, db);
			}

			const requestID = crypto.randomUUID();
			setPendingRequest(requestID, { account, providerID });
			output.headers[INTERNAL_REQUEST_HEADER] = requestID;
		},

		"chat.message": async (_input, output) => {
			// Balancing on: the priority list decides the provider/model for every
			// message (recomputed per message -> failover and recovery for free).
			if (getBalancingEnabled(db)) {
				const selection = resolveActiveSelection(
					db,
					undefined,
					output.message.model?.providerID,
				);
				if (!selection) return;
				setActiveAccount(db, selection.providerID, selection.account.alias);
				output.message.model = {
					modelID: selection.modelID,
					providerID: selection.providerID,
				};
				return;
			}

			// Balancing off: keep opencode's native choice; only fill when missing.
			if (output.message.model?.providerID && output.message.model?.modelID)
				return;

			const selected = getSelectedAccount(db);
			if (!selected) return;
			const model = getSelectedModel(db, selected.providerID);
			if (!model) return;

			output.message.model = {
				modelID: model.modelID,
				providerID: model.providerID,
			};
		},

		"command.execute.before": async (input, output) => {
			if (input.command !== "balancer") return;
			const result = runSafeFallbackBalancerCommand(db, input.arguments);
			output.parts.length = 0;
			await showToast(client, result.split("\n")[0] ?? result, "info");
			throw new Error(`[balancer]\n${result}`);
		},
		config: async (cfg) => {
			configureFallbackCommand(cfg);
		},
		"experimental.chat.messages.transform": async (_input, output) => {
			output.messages = output.messages.filter((message) => {
				return !message.parts.some((part: any) => {
					return part?.metadata?.[BALANCER_METADATA_KEY] === true;
				});
			});
		},

		tool: {
			balancer_command: tool({
				args: {
					command: tool.schema
						.string()
						.describe("Command arguments for /balancer."),
				},
				description: "Run fallback account balancer commands.",
				execute: async (args) =>
					runSafeFallbackBalancerCommand(db, args.command),
			}),
		},
	};
}

export const serverPlugin = (async ({ client }) => {
	const db = openBalancerDatabase(storePath());
	migrate(db);
	installFetchPatch(db, client);

	return createServerHooks({
		cacheUpdate: () =>
			checkAndInvalidateOutdatedPackageCache({
				currentVersion: packageJson.version,
				moduleUrl: import.meta.url,
				packageName: PACKAGE_NAME,
			}),
		client,
		db,
	});
}) satisfies Plugin;
