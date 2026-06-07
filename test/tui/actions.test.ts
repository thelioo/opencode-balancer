import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getActiveAccount,
	saveAccount,
	setSelectedModel,
} from "../../src/core/accounts";
import {
	closeBalancerDatabase,
	openBalancerDatabase,
} from "../../src/core/database";
import { listEvents } from "../../src/core/events";
import { isNativeAuthCaptureSuppressed } from "../../src/core/native-auth-suppression";
import {
	createPendingConnection,
	listPendingConnections,
} from "../../src/core/pending";
import { migrate } from "../../src/core/schema";
import type { Account } from "../../src/core/types";
import { getUsageSnapshot } from "../../src/core/usage/store";
import type { ProviderUsageSnapshot } from "../../src/core/usage/types";
import {
	activateAccount,
	refreshUsageForAccount,
	removeAccountFromTui,
	removePendingFromTui,
	renameAccountFromTui,
	savePendingAlias,
} from "../../src/tui/actions";
import type { BalancerTuiState } from "../../src/tui/state";

let dbPaths: string[] = [];

afterEach(() => {
	for (const dbPath of dbPaths) {
		closeBalancerDatabase(dbPath);
		rmSync(dbPath, { force: true });
		rmSync(`${dbPath}-wal`, { force: true });
		rmSync(`${dbPath}-shm`, { force: true });
	}
	dbPaths = [];
});

function createState(accounts: Account[] = []) {
	const dbPath = join(
		mkdtempSync(join(tmpdir(), "opencode-balancer-actions-")),
		"balancer.sqlite",
	);
	dbPaths.push(dbPath);
	const db = openBalancerDatabase(dbPath);
	migrate(db);
	let refreshes = 0;
	let accountView = accounts;
	let pendingView: ReturnType<typeof listPendingConnections> = [];

	return {
		db,
		refreshCount: () => refreshes,
		state: {
			accounts: () => accountView,
			db,
			dispose: () => closeBalancerDatabase(dbPath),
			events: () => [],
			pending: () => pendingView,
			refresh: () => {
				refreshes += 1;
				accountView = accountView.filter((account) => Boolean(account));
				pendingView = listPendingConnections(db);
			},
			removeAccountView: (providerID, alias) => {
				accountView = accountView.filter(
					(account) =>
						account.providerID !== providerID || account.alias !== alias,
				);
			},
			removePendingView: (pendingID) => {
				pendingView = pendingView.filter((pending) => pending.id !== pendingID);
			},
			version: () => 0,
		} satisfies BalancerTuiState,
	};
}

describe("tui actions", () => {
	test("savePendingAlias completes a pending connection and refreshes state", async () => {
		const { db, state, refreshCount } = createState();
		const pending = createPendingConnection(
			db,
			"anthropic",
			{ key: "sk-ant-test", type: "api" },
			"http",
		);

		const account = await savePendingAlias(state, pending.id, "Work Account");

		expect(account.providerID).toBe("anthropic");
		expect(account.alias).toBe("work-account");
		expect(getActiveAccount(db, "anthropic")?.alias).toBe("work-account");
		expect(listPendingConnections(db)).toEqual([]);
		expect(refreshCount()).toBe(1);
	});

	test("activateAccount sets the active account, updates opencode auth, and refreshes state", async () => {
		const { db, state, refreshCount } = createState();
		const account = saveAccount(db, "openai", "work", {
			key: "sk-openai-test",
			type: "api",
		});
		saveAccount(db, "openai", "personal", {
			key: "sk-openai-personal",
			type: "api",
		});
		const calls: unknown[] = [];
		const toasts: unknown[] = [];
		const api = {
			client: {
				auth: {
					set: async (input: unknown) => {
						calls.push(input);
					},
				},
			},
			ui: {
				toast: (input: unknown) => {
					toasts.push(input);
				},
			},
		};

		await activateAccount(api, state, "openai", "work");

		expect(getActiveAccount(db, "openai")?.alias).toBe("work");
		expect(isNativeAuthCaptureSuppressed(db, "openai")).toBe(true);
		expect(calls).toEqual([{ body: account.auth, path: { id: "openai" } }]);
		expect(toasts).toEqual([
			{ message: "Activated openai/work.", variant: "success" },
		]);
		expect(refreshCount()).toBe(1);
	});

	test("activateAccount applies the provider model natively when the selected provider changes", async () => {
		const { db, state } = createState();
		saveAccount(db, "github-copilot", "gh1", {
			access: "access",
			expires: Date.now() + 1000,
			refresh: "refresh",
			type: "oauth",
		});
		saveAccount(db, "openai", "work", { key: "sk-openai-test", type: "api" });
		const dispatched: string[] = [];
		const appliedProviders: string[] = [];
		const api = {
			client: {
				auth: {
					set: async () => {},
				},
			},
			keymap: {
				dispatchCommand: (command: string) => {
					dispatched.push(command);
				},
			},
		};

		await activateAccount(api, state, "github-copilot", "gh1", {
			applyNativeProviderModel: async (providerID) => {
				appliedProviders.push(providerID);
				return true;
			},
			sessionProviderID: "openai",
		});

		expect(dispatched).toEqual([]);
		expect(appliedProviders).toEqual(["github-copilot"]);
	});

	test("activateAccount applies the provider model natively when switching providers even if a model was selected before", async () => {
		const { db, state } = createState();
		saveAccount(db, "openai", "op1", { key: "sk-openai-test", type: "api" });
		setSelectedModel(db, "openai", "gpt-5.5");
		saveAccount(db, "github-copilot", "gh1", {
			access: "access",
			expires: Date.now() + 1000,
			refresh: "refresh",
			type: "oauth",
		});
		const appliedProviders: string[] = [];
		const api = {
			client: {
				auth: {
					set: async () => {},
				},
			},
		};

		await activateAccount(api, state, "openai", "op1", {
			applyNativeProviderModel: async (providerID) => {
				appliedProviders.push(providerID);
				return true;
			},
			sessionProviderID: "github-copilot",
		});

		expect(appliedProviders).toEqual(["openai"]);
	});

	test("activateAccount does not apply the provider model natively when selecting the current provider again", async () => {
		const { db, state } = createState();
		saveAccount(db, "github-copilot", "gh1", {
			access: "access",
			expires: Date.now() + 1000,
			refresh: "refresh",
			type: "oauth",
		});
		const appliedProviders: string[] = [];
		const api = {
			client: {
				auth: {
					set: async () => {},
				},
			},
		};

		await activateAccount(api, state, "github-copilot", "gh1", {
			applyNativeProviderModel: async (providerID) => {
				appliedProviders.push(providerID);
				return true;
			},
			sessionProviderID: "github-copilot",
		});

		expect(appliedProviders).toEqual([]);
	});

	test("activateAccount applies the provider model natively when the session provider differs from the selected provider", async () => {
		const { db, state } = createState();
		saveAccount(db, "openai", "work", { key: "sk-openai-work", type: "api" });
		saveAccount(db, "openai", "personal", {
			key: "sk-openai-personal",
			type: "api",
		});
		const appliedProviders: string[] = [];
		const api = {
			client: {
				auth: {
					set: async () => {},
				},
			},
		};

		await activateAccount(api, state, "openai", "work", {
			applyNativeProviderModel: async (providerID) => {
				appliedProviders.push(providerID);
				return true;
			},
			sessionProviderID: "github-copilot",
		});

		expect(appliedProviders).toEqual(["openai"]);
	});

	test("activateAccount sends the DB-selected account auth instead of stale state auth", async () => {
		const { db, state } = createState([
			{
				alias: "work",
				auth: { key: "sk-openai-stale", type: "api" },
				authType: "api",
				createdAt: 1,
				disabled: false,
				failures: 0,
				providerID: "openai",
				updatedAt: 1,
			},
		]);
		const account = saveAccount(db, "openai", "work", {
			key: "sk-openai-current",
			type: "api",
		});
		const calls: unknown[] = [];
		const api = {
			client: {
				auth: {
					set: async (input: unknown) => {
						calls.push(input);
					},
				},
			},
		};

		await activateAccount(api, state, "openai", "work");

		expect(calls).toEqual([{ body: account.auth, path: { id: "openai" } }]);
	});

	test("activateAccount still refreshes when opencode auth update fails", async () => {
		const { db, state, refreshCount } = createState();
		saveAccount(db, "anthropic", "work", { key: "sk-ant-test", type: "api" });
		const api = {
			client: {
				auth: {
					set: async () => {
						throw new Error("opencode unavailable");
					},
				},
			},
		};

		await expect(
			activateAccount(api, state, "anthropic", "work"),
		).resolves.toBeUndefined();

		expect(getActiveAccount(db, "anthropic")?.alias).toBe("work");
		expect(refreshCount()).toBe(1);
	});

	test("removeAccountFromTui deletes an account, records an event, refreshes state, and shows success", () => {
		const { db, state, refreshCount } = createState([
			{
				alias: "work",
				auth: { key: "sk-openai-test", type: "api" },
				authType: "api",
				createdAt: 1,
				disabled: false,
				failures: 0,
				providerID: "openai",
				updatedAt: 1,
			},
		]);
		saveAccount(db, "openai", "work", { key: "sk-openai-test", type: "api" });
		const toasts: unknown[] = [];

		removeAccountFromTui(
			{ ui: { toast: (input: unknown) => toasts.push(input) } },
			state,
			"openai",
			"work",
		);

		expect(getActiveAccount(db, "openai")).toBeUndefined();
		expect(state.accounts()).toEqual([]);
		expect(listEvents(db, 1)[0]).toMatchObject({
			alias: "work",
			message: "Removed account openai/work.",
			providerID: "openai",
			type: "account_removed",
		});
		expect(refreshCount()).toBe(1);
		expect(toasts).toEqual([
			{ message: "Removed account openai/work.", variant: "success" },
		]);
	});

	test("renameAccountFromTui renames an account, refreshes state, and shows success", () => {
		const { db, state, refreshCount } = createState();
		saveAccount(db, "openai", "a1b2c", { key: "sk-openai-test", type: "api" });
		const toasts: unknown[] = [];

		const account = renameAccountFromTui(
			{ ui: { toast: (input: unknown) => toasts.push(input) } },
			state,
			"openai",
			"a1b2c",
			"Work Account",
		);

		expect(account).toMatchObject({
			alias: "work-account",
			providerID: "openai",
		});
		expect(refreshCount()).toBe(1);
		expect(toasts).toEqual([
			{ message: "Renamed openai/a1b2c to work-account.", variant: "success" },
		]);
	});

	test("removePendingFromTui dismisses a pending connection, refreshes state, and shows success", () => {
		const { db, state, refreshCount } = createState();
		const pending = createPendingConnection(
			db,
			"anthropic",
			{ key: "sk-ant-test", type: "api" },
			"http",
		);
		state.refresh();
		const toasts: unknown[] = [];

		removePendingFromTui(
			{ ui: { toast: (input: unknown) => toasts.push(input) } },
			state,
			pending.id,
		);

		expect(listPendingConnections(db)).toMatchObject([
			{ id: pending.id, promptStatus: "dismissed" },
		]);
		expect(state.pending()).toEqual([]);
		expect(refreshCount()).toBe(2);
		expect(toasts).toEqual([
			{ message: "Removed pending connection.", variant: "success" },
		]);
	});

	test("refreshUsageForAccount persists exact usage, appends an event, refreshes state, and shows success", async () => {
		const { db, state, refreshCount } = createState();
		const account = saveAccount(db, "anthropic", "work", {
			key: "sk-ant-test",
			type: "api",
		});
		const toasts: unknown[] = [];
		const snapshot: ProviderUsageSnapshot = {
			alias: "work",
			confidence: "exact",
			fetchedAt: 123,
			message: "Usage refreshed.",
			providerID: "anthropic",
			usedTokens: 42,
		};

		await refreshUsageForAccount(
			{ ui: { toast: (input: unknown) => toasts.push(input) } },
			state,
			"anthropic",
			"work",
			{
				refreshUsage: async (received) => {
					expect(received).toEqual(account);
					return snapshot;
				},
			},
		);

		expect(getUsageSnapshot(db, "anthropic", "work")).toEqual(snapshot);
		expect(listEvents(db, 1)[0]).toMatchObject({
			alias: "work",
			message: "Usage refreshed.",
			providerID: "anthropic",
			type: "usage_refreshed",
		});
		expect(refreshCount()).toBe(1);
		expect(toasts).toEqual([
			{ message: "Usage refreshed.", variant: "success" },
		]);
	});

	test("refreshUsageForAccount records unavailable usage as a warning", async () => {
		const { db, state } = createState();
		saveAccount(db, "openai", "work", { key: "sk-openai-test", type: "api" });
		const toasts: unknown[] = [];
		const snapshot: ProviderUsageSnapshot = {
			alias: "work",
			confidence: "unavailable",
			fetchedAt: 456,
			message: "Usage unavailable.",
			providerID: "openai",
		};

		await refreshUsageForAccount(
			{ ui: { toast: (input: unknown) => toasts.push(input) } },
			state,
			"openai",
			"work",
			{ refreshUsage: async () => snapshot },
		);

		expect(getUsageSnapshot(db, "openai", "work")).toEqual(snapshot);
		expect(listEvents(db, 1)[0]).toMatchObject({
			alias: "work",
			message: "Usage unavailable.",
			providerID: "openai",
			type: "usage_unavailable",
		});
		expect(toasts).toEqual([
			{ message: "Usage unavailable.", variant: "warning" },
		]);
	});

	test("refreshUsageForAccount warns without throwing when account is missing", async () => {
		const { state, refreshCount } = createState();
		const toasts: unknown[] = [];

		await expect(
			refreshUsageForAccount(
				{ ui: { toast: (input: unknown) => toasts.push(input) } },
				state,
				"anthropic",
				"missing",
				{
					refreshUsage: async () => {
						throw new Error("should not refresh missing accounts");
					},
				},
			),
		).resolves.toBeUndefined();

		expect(refreshCount()).toBe(0);
		expect(toasts).toEqual([
			{ message: "Account not found: anthropic/missing", variant: "error" },
		]);
	});
});
