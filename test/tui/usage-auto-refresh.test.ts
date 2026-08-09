import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveAccount } from "../../src/core/accounts";
import {
	closeBalancerDatabase,
	openBalancerDatabase,
} from "../../src/core/database";
import { migrate } from "../../src/core/schema";
import { getUsageSnapshot } from "../../src/core/usage/store";
import type { BalancerTuiState } from "../../src/tui/state";
import { createUsageAutoRefresh } from "../../src/tui/usage-auto-refresh";

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

function createState() {
	const dbPath = join(
		mkdtempSync(join(tmpdir(), "opencode-balancer-auto-refresh-")),
		"balancer.sqlite",
	);
	dbPaths.push(dbPath);
	const db = openBalancerDatabase(dbPath);
	migrate(db);
	let refreshes = 0;

	return {
		db,
		refreshCount: () => refreshes,
		state: {
			accounts: () => [],
			db,
			dispose: () => closeBalancerDatabase(dbPath),
			events: () => [],
			pending: () => [],
			refresh: () => {
				refreshes += 1;
			},
			removeAccountView: () => {},
			removePendingView: () => {},
			snapshot: () => null,
			snapshotStale: () => false,
			version: () => 0,
		} satisfies BalancerTuiState,
	};
}

describe("usage auto refresh", () => {
	test("refreshes every account without showing toasts", async () => {
		const { db, state, refreshCount } = createState();
		saveAccount(db, "openai", "work", { key: "sk-openai", type: "api" });
		saveAccount(db, "github-copilot", "personal", {
			access: "a",
			expires: 1,
			refresh: "r",
			type: "oauth",
		});
		const toasts: unknown[] = [];
		const refreshed: string[] = [];

		const autoRefresh = createUsageAutoRefresh(
			{ ui: { toast: (input: unknown) => toasts.push(input) } },
			state,
			{
				intervalMs: 0,
				refreshUsage: async (account) => {
					refreshed.push(`${account.providerID}/${account.alias}`);
					return {
						alias: account.alias,
						confidence: "exact",
						fetchedAt: 123,
						message: `usage ${account.providerID}/${account.alias}`,
						providerID: account.providerID,
						usedPercent: 10,
					};
				},
			},
		);

		await autoRefresh.refreshNow();

		expect(refreshed.toSorted()).toEqual([
			"github-copilot/personal",
			"openai/work",
		]);
		expect(getUsageSnapshot(db, "openai", "work")?.message).toBe(
			"usage openai/work",
		);
		expect(getUsageSnapshot(db, "github-copilot", "personal")?.message).toBe(
			"usage github-copilot/personal",
		);
		expect(refreshCount()).toBe(2);
		expect(toasts).toEqual([]);
		autoRefresh.dispose();
	});

	test("refreshes on prompt activity with debounce", async () => {
		const { db, state } = createState();
		saveAccount(db, "openai", "work", { key: "sk-openai", type: "api" });
		let now = 1_000;
		let calls = 0;
		const autoRefresh = createUsageAutoRefresh(
			{ ui: { toast: () => {} } },
			state,
			{
				intervalMs: 0,
				now: () => now,
				promptDebounceMs: 10_000,
				refreshUsage: async (account) => {
					calls += 1;
					return {
						alias: account.alias,
						confidence: "exact",
						fetchedAt: now,
						message: "usage refreshed",
						providerID: account.providerID,
					};
				},
			},
		);

		await autoRefresh.refreshForPrompt();
		await autoRefresh.refreshForPrompt();
		now += 10_000;
		await autoRefresh.refreshForPrompt();

		expect(calls).toBe(2);
		autoRefresh.dispose();
	});
});
