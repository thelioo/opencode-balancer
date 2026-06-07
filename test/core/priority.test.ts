import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveAccount, setActiveAccount } from "../../src/core/accounts";
import {
	closeBalancerDatabase,
	openBalancerDatabase,
} from "../../src/core/database";
import {
	getBalancingEnabled,
	listProviderPriority,
	moveProvider,
	resolveActiveSelection,
	setBalancingEnabled,
	setProviderEnabled,
	setProviderModel,
} from "../../src/core/priority";
import { migrate } from "../../src/core/schema";

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

function createDb() {
	const dbPath = join(
		mkdtempSync(join(tmpdir(), "opencode-balancer-priority-")),
		"balancer.sqlite",
	);
	dbPaths.push(dbPath);
	const db = openBalancerDatabase(dbPath);
	migrate(db);
	return db;
}

describe("provider priority", () => {
	test("auto-includes every provider that has an account, enabled, alphabetical", () => {
		const db = createDb();
		saveAccount(db, "openai", "op1", { key: "k", type: "api" });
		saveAccount(db, "github-copilot", "gh1", { key: "k", type: "api" });

		const list = listProviderPriority(db);

		expect(list.map((e) => e.providerID)).toEqual(["github-copilot", "openai"]);
		expect(list.map((e) => e.position)).toEqual([0, 1]);
		expect(list.every((e) => e.enabled)).toBe(true);
		expect(list.every((e) => e.modelID === undefined)).toBe(true);
	});

	test("excludes providers that no longer have accounts", () => {
		const db = createDb();
		saveAccount(db, "openai", "op1", { key: "k", type: "api" });
		setProviderModel(db, "anthropic", "claude"); // stored but no account

		expect(listProviderPriority(db).map((e) => e.providerID)).toEqual([
			"openai",
		]);
	});

	test("persists model, enabled flag, and order", () => {
		const db = createDb();
		saveAccount(db, "openai", "op1", { key: "k", type: "api" });
		saveAccount(db, "github-copilot", "gh1", { key: "k", type: "api" });

		setProviderModel(db, "openai", "gpt-5.5");
		setProviderEnabled(db, "github-copilot", false);

		const list = listProviderPriority(db);
		const openai = list.find((e) => e.providerID === "openai");
		const copilot = list.find((e) => e.providerID === "github-copilot");
		expect(openai?.modelID).toBe("gpt-5.5");
		expect(copilot?.enabled).toBe(false);
	});

	test("moveProvider reorders priority and clamps at the ends", () => {
		const db = createDb();
		saveAccount(db, "openai", "op1", { key: "k", type: "api" });
		saveAccount(db, "github-copilot", "gh1", { key: "k", type: "api" });
		saveAccount(db, "anthropic", "an1", { key: "k", type: "api" });
		// initial alpha: anthropic, github-copilot, openai

		moveProvider(db, "openai", -1); // openai up one -> anthropic, openai, github-copilot
		expect(listProviderPriority(db).map((e) => e.providerID)).toEqual([
			"anthropic",
			"openai",
			"github-copilot",
		]);

		moveProvider(db, "anthropic", -1); // already top, no change
		expect(listProviderPriority(db).map((e) => e.providerID)).toEqual([
			"anthropic",
			"openai",
			"github-copilot",
		]);

		moveProvider(db, "github-copilot", 1); // already bottom, no change
		expect(listProviderPriority(db).map((e) => e.providerID)).toEqual([
			"anthropic",
			"openai",
			"github-copilot",
		]);
	});

	test("balancing toggle defaults off and persists", () => {
		const db = createDb();
		expect(getBalancingEnabled(db)).toBe(false);
		setBalancingEnabled(db, true);
		expect(getBalancingEnabled(db)).toBe(true);
		setBalancingEnabled(db, false);
		expect(getBalancingEnabled(db)).toBe(false);
	});
});

describe("resolveActiveSelection", () => {
	test("returns the highest-priority enabled provider with a model and a healthy account", () => {
		const db = createDb();
		saveAccount(db, "github-copilot", "gh1", { key: "k", type: "api" });
		saveAccount(db, "openai", "op1", { key: "k", type: "api" });
		setProviderModel(db, "github-copilot", "gemini-2.5-pro");
		setProviderModel(db, "openai", "gpt-5.5");
		// alpha order: github-copilot (#0), openai (#1)

		const selection = resolveActiveSelection(db, 1000);
		expect(selection?.providerID).toBe("github-copilot");
		expect(selection?.modelID).toBe("gemini-2.5-pro");
		expect(selection?.account.alias).toBe("gh1");
	});

	test("skips providers with no model set", () => {
		const db = createDb();
		saveAccount(db, "github-copilot", "gh1", { key: "k", type: "api" });
		saveAccount(db, "openai", "op1", { key: "k", type: "api" });
		setProviderModel(db, "openai", "gpt-5.5");
		// github-copilot has no model -> skipped despite higher priority

		expect(resolveActiveSelection(db, 1000)?.providerID).toBe("openai");
	});

	test("skips disabled providers", () => {
		const db = createDb();
		saveAccount(db, "github-copilot", "gh1", { key: "k", type: "api" });
		saveAccount(db, "openai", "op1", { key: "k", type: "api" });
		setProviderModel(db, "github-copilot", "gemini-2.5-pro");
		setProviderModel(db, "openai", "gpt-5.5");
		setProviderEnabled(db, "github-copilot", false);

		expect(resolveActiveSelection(db, 1000)?.providerID).toBe("openai");
	});

	test("falls over to the next provider when all accounts are rate limited", () => {
		const db = createDb();
		saveAccount(db, "github-copilot", "gh1", { key: "k", type: "api" });
		saveAccount(db, "openai", "op1", { key: "k", type: "api" });
		setProviderModel(db, "github-copilot", "gemini-2.5-pro");
		setProviderModel(db, "openai", "gpt-5.5");
		// rate-limit the only copilot account until t=5000
		db.query(
			"UPDATE accounts SET rate_limited_until = ? WHERE provider_id = 'github-copilot'",
		).run(5000);

		expect(resolveActiveSelection(db, 1000)?.providerID).toBe("openai");
		// after the limit expires, recovery back to the higher-priority provider
		expect(resolveActiveSelection(db, 6000)?.providerID).toBe("github-copilot");
	});

	test("prefers the active account within the chosen provider", () => {
		const db = createDb();
		saveAccount(db, "openai", "op1", { key: "k1", type: "api" });
		saveAccount(db, "openai", "op2", { key: "k2", type: "api" });
		setProviderModel(db, "openai", "gpt-5.5");
		setActiveAccount(db, "openai", "op2");

		expect(resolveActiveSelection(db, 1000)?.account.alias).toBe("op2");
	});

	test("tries another healthy account in the current provider before falling over cross-provider", () => {
		const db = createDb();
		saveAccount(db, "github-copilot", "gh1", { key: "gh", type: "api" });
		saveAccount(db, "openai", "full", { key: "full", type: "api" });
		saveAccount(db, "openai", "available", { key: "available", type: "api" });
		setProviderModel(db, "github-copilot", "claude-haiku-4.5");
		setProviderModel(db, "openai", "gpt-5.5");
		setActiveAccount(db, "openai", "full");
		db.query(
			"UPDATE accounts SET rate_limited_until = ? WHERE provider_id = 'openai' AND alias = 'full'",
		).run(5000);

		const selection = resolveActiveSelection(db, 1000, "openai");

		expect(selection?.providerID).toBe("openai");
		expect(selection?.account.alias).toBe("available");
	});
});
