import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveAccount } from "../../src/core/accounts";
import { openBalancerDatabase } from "../../src/core/database";
import { appendEvent } from "../../src/core/events";
import { createPendingConnection } from "../../src/core/pending";
import {
	setBalancingEnabled,
	setQuotaAwareSelectionEnabled,
} from "../../src/core/priority";
import { migrate } from "../../src/core/schema";
import { readSnapshot, snapshotsEqual } from "../../src/tui/db-worker";

let configDirs: string[] = [];

afterEach(() => {
	for (const dir of configDirs) {
		rmSync(dir, { force: true, recursive: true });
	}
	configDirs = [];
	delete Bun.env.OPENCODE_CONFIG_DIR;
});

function withTempConfigDir() {
	const dir = mkdtempSync(join(tmpdir(), "opencode-balancer-worker-test-"));
	configDirs.push(dir);
	Bun.env.OPENCODE_CONFIG_DIR = dir;
	return join(dir, "balancer.sqlite");
}

describe("db-worker business logic", () => {
	test("readSnapshot extracts complete database state correctly", () => {
		const dbPath = withTempConfigDir();
		const db = openBalancerDatabase(dbPath);
		migrate(db);

		saveAccount(db, "anthropic", "work", { key: "sk-ant-test", type: "api" });
		createPendingConnection(
			db,
			"openai",
			{ key: "sk-openai-test", type: "api" },
			"http",
		);
		appendEvent(db, {
			alias: "work",
			message: "saved work account",
			providerID: "anthropic",
			type: "account_saved",
		});
		setBalancingEnabled(db, true);
		setQuotaAwareSelectionEnabled(db, true);

		const snapshot = readSnapshot();

		expect(snapshot.accounts.map((a) => `${a.providerID}/${a.alias}`)).toEqual([
			"anthropic/work",
		]);
		expect(
			snapshot.pending.map((p) => `${p.providerID}/${p.authType}`),
		).toEqual(["openai/api"]);
		expect(snapshot.events.map((e) => e.message)).toEqual([
			"saved work account",
		]);
		expect(snapshot.balancingEnabled).toBe(true);
		expect(snapshot.quotaAwareSelectionEnabled).toBe(true);
		expect(snapshot.usageSnapshots).toBeDefined();
	});

	test("snapshotsEqual detects changes when database data mutates", () => {
		const dbPath = withTempConfigDir();
		const db = openBalancerDatabase(dbPath);
		migrate(db);

		saveAccount(db, "anthropic", "work", { key: "sk-ant-test", type: "api" });
		const snap1 = readSnapshot();

		// Add another account
		saveAccount(db, "openai", "personal", {
			key: "sk-openai-test",
			type: "api",
		});
		const snap2 = readSnapshot();

		expect(snapshotsEqual(snap1, snap2)).toBe(false);
	});
});
