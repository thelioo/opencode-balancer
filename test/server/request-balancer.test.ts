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
	chooseFailoverAccount,
	markRateLimited,
} from "../../src/server/request-balancer";

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

describe("request balancer", () => {
	test("chooses another enabled account after rate limit", () => {
		const database = db();
		saveAccount(database, "openai", "main", { key: "sk-main", type: "api" });
		saveAccount(database, "openai", "backup", {
			key: "sk-backup",
			type: "api",
		});
		markRateLimited(database, "openai", "main", 60_000);
		expect(chooseFailoverAccount(database, "openai", "main")?.alias).toBe(
			"backup",
		);
	});

	test("marking a missing account rate limited is a no-op", () => {
		const database = db();
		saveAccount(database, "openai", "backup", {
			key: "sk-backup",
			type: "api",
		});

		markRateLimited(database, "openai", "missing", 60_000);

		const account = getAccount(database, "openai", "backup");
		expect(account?.failures).toBe(0);
		expect(account?.rateLimitedUntil).toBeUndefined();
	});

	test("skips disabled failover accounts", () => {
		const database = db();
		saveAccount(database, "openai", "main", { key: "sk-main", type: "api" });
		saveAccount(database, "openai", "backup", {
			key: "sk-backup",
			type: "api",
		});
		database
			.query(
				"UPDATE accounts SET disabled = 1 WHERE provider_id = ? AND alias = ?",
			)
			.run("openai", "backup");
		markRateLimited(database, "openai", "main", 60_000);

		expect(chooseFailoverAccount(database, "openai", "main")).toBeUndefined();
	});

	test("skips rate-limited failover accounts", () => {
		const database = db();
		saveAccount(database, "openai", "main", { key: "sk-main", type: "api" });
		saveAccount(database, "openai", "backup", {
			key: "sk-backup",
			type: "api",
		});
		markRateLimited(database, "openai", "backup", 60_000);
		markRateLimited(database, "openai", "main", 60_000);

		expect(chooseFailoverAccount(database, "openai", "main")).toBeUndefined();
	});
});
