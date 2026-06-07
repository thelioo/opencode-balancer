import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAccount, saveAccount } from "../../src/core/accounts";
import {
	closeBalancerDatabase,
	openBalancerDatabase,
} from "../../src/core/database";
import { migrate } from "../../src/core/schema";
import {
	getUsageSnapshot,
	saveUsageSnapshot,
} from "../../src/core/usage/store";

let dirs: string[] = [];
let paths: string[] = [];

function db() {
	const dir = mkdtempSync(join(tmpdir(), "opencode-balancer-"));
	dirs.push(dir);
	const path = join(dir, "balancer.sqlite");
	paths.push(path);
	const database = openBalancerDatabase(path);
	migrate(database);
	return database;
}

afterEach(() => {
	for (const path of paths) closeBalancerDatabase(path);
	for (const dir of dirs) rmSync(dir, { force: true, recursive: true });
	dirs = [];
	paths = [];
});

describe("usage snapshots", () => {
	test("saves and replaces a provider account snapshot", () => {
		const database = db();
		saveUsageSnapshot(database, {
			alias: "work",
			confidence: "exact",
			fetchedAt: 100,
			message: "10% used",
			planName: "team",
			providerID: "anthropic",
			remainingTokens: 90,
			usedPercent: 10,
			usedTokens: 10,
		});
		saveUsageSnapshot(database, {
			alias: "work",
			confidence: "estimated",
			fetchedAt: 200,
			message: "25% used",
			planName: "team",
			providerID: "anthropic",
			remainingTokens: 75,
			usedPercent: 25,
			usedTokens: 25,
		});

		const snapshot = getUsageSnapshot(database, "anthropic", "work");
		const row = database
			.query<{ count: number }, []>(
				"SELECT COUNT(*) AS count FROM usage_snapshots WHERE provider_id = 'anthropic' AND alias = 'work'",
			)
			.get();

		expect(snapshot?.fetchedAt).toBe(200);
		expect(snapshot?.confidence).toBe("estimated");
		expect(snapshot?.usedPercent).toBe(25);
		expect(row?.count).toBe(1);
	});

	test("separates falsy redacted payloads from normalized snapshot data", () => {
		const database = db();
		saveUsageSnapshot(database, {
			alias: "work",
			confidence: "exact",
			fetchedAt: 100,
			message: "usage fetched",
			providerID: "anthropic",
			rawRedacted: false,
		});

		const row = database
			.query<{ normalized_json: string; raw_redacted_json: string | null }, []>(
				`SELECT normalized_json, raw_redacted_json
                 FROM usage_snapshots
                 WHERE provider_id = 'anthropic' AND alias = 'work'`,
			)
			.get();
		const normalized = JSON.parse(row?.normalized_json ?? "{}") as Record<
			string,
			unknown
		>;

		expect(Object.hasOwn(normalized, "rawRedacted")).toBe(false);
		expect(row?.raw_redacted_json).toBe("false");
		expect(getUsageSnapshot(database, "anthropic", "work")?.rawRedacted).toBe(
			false,
		);
	});

	test("clears a temporary rate-limit marker when exact usage shows quota remains", () => {
		const database = db();
		saveAccount(database, "openai", "canhao", { key: "sk", type: "api" });
		database
			.query(
				"UPDATE accounts SET rate_limited_until = ? WHERE provider_id = 'openai' AND alias = 'canhao'",
			)
			.run(Date.now() + 60_000);

		saveUsageSnapshot(database, {
			alias: "canhao",
			confidence: "exact",
			fetchedAt: Date.now(),
			message: "OpenAI ChatGPT usage fetched.",
			providerID: "openai",
			usedPercent: 24,
		});

		expect(
			getAccount(database, "openai", "canhao")?.rateLimitedUntil,
		).toBeUndefined();
	});
});
