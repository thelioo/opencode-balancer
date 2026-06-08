import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	closeBalancerDatabase,
	openBalancerDatabase,
	secureDatabaseFiles,
} from "../../src/core/database";
import { migrate } from "../../src/core/schema";

let dirs: string[] = [];
let dbPaths: string[] = [];

function tempDb() {
	const dir = mkdtempSync(join(tmpdir(), "opencode-balancer-"));
	dirs.push(dir);
	const path = join(dir, "balancer.sqlite");
	dbPaths.push(path);
	return path;
}

afterEach(() => {
	for (const path of dbPaths) closeBalancerDatabase(path);
	for (const dir of dirs) rmSync(dir, { force: true, recursive: true });
	dbPaths = [];
	dirs = [];
});

describe("schema migrations", () => {
	test("creates all required tables", () => {
		const db = openBalancerDatabase(tempDb());
		migrate(db);
		const rows = db
			.query<{ name: string }, []>(
				"SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
			)
			.all()
			.map((row) => row.name);

		expect(rows).toContain("accounts");
		expect(rows).toContain("events");
		expect(rows).toContain("pending_connections");
		expect(rows).toContain("provider_state");
		expect(rows).toContain("schema_migrations");
		expect(rows).toContain("usage_snapshots");
	});

	test("records migration version one", () => {
		const db = openBalancerDatabase(tempDb());
		migrate(db);
		const row = db
			.query<{ version: number }, []>("SELECT version FROM schema_migrations")
			.get();
		expect(row?.version).toBe(1);
	});

	test("runs migration idempotently", () => {
		const db = openBalancerDatabase(tempDb());
		migrate(db);
		migrate(db);

		const row = db
			.query<{ count: number }, []>(
				"SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 1",
			)
			.get();
		expect(row?.count).toBe(1);
	});

	test("repairs incomplete existing version one databases", () => {
		const db = openBalancerDatabase(tempDb());
		db.exec(`
            CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );
            INSERT INTO schema_migrations (version, applied_at) VALUES (1, 1);

            CREATE TABLE accounts (
                provider_id TEXT NOT NULL,
                alias TEXT NOT NULL,
                auth_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (provider_id, alias)
            );
            INSERT INTO accounts (provider_id, alias, auth_json, created_at, updated_at)
            VALUES ('openai', 'default', '{"type":"api","key":"redacted"}', 1, 1);

            CREATE TABLE provider_state (
                provider_id TEXT PRIMARY KEY,
                active_alias TEXT,
                updated_at INTEGER NOT NULL
            );
            INSERT INTO provider_state (provider_id, active_alias, updated_at)
            VALUES ('openai', 'default', 1);

            CREATE TABLE pending_connections (
                id TEXT PRIMARY KEY,
                provider_id TEXT NOT NULL,
                auth_json TEXT NOT NULL,
                source TEXT NOT NULL,
                captured_at INTEGER NOT NULL,
                prompt_status TEXT NOT NULL
            );
            INSERT INTO pending_connections (id, provider_id, auth_json, source, captured_at, prompt_status)
            VALUES ('pending-1', 'openai', '{"type":"api","key":"redacted"}', 'native', 1, 'pending');
        `);

		migrate(db);

		const accountColumns = db
			.query<{ name: string }, []>("PRAGMA table_info(accounts)")
			.all()
			.map((row) => row.name);
		const pendingColumns = db
			.query<{ name: string }, []>("PRAGMA table_info(pending_connections)")
			.all()
			.map((row) => row.name);
		const account = db
			.query<{ auth_type: string }, []>("SELECT auth_type FROM accounts")
			.get();
		const pending = db
			.query<{ auth_type: string }, []>(
				"SELECT auth_type FROM pending_connections",
			)
			.get();
		const tables = db
			.query<{ name: string }, []>(
				"SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
			)
			.all()
			.map((row) => row.name);

		expect(accountColumns).toContain("auth_type");
		expect(accountColumns).toContain("last_used_at");
		expect(accountColumns).toContain("rate_limited_until");
		expect(accountColumns).toContain("failures");
		expect(accountColumns).toContain("disabled");
		expect(pendingColumns).toContain("auth_type");
		expect(
			db
				.query<{ name: string }, []>("PRAGMA table_info(provider_state)")
				.all()
				.map((row) => row.name),
		).toContain("metadata_json");
		expect(tables).toContain("events");
		expect(tables).toContain("usage_snapshots");
		expect(account?.auth_type).toBe("api");
		expect(pending?.auth_type).toBe("api");
		expect(
			db
				.query<{ disabled: number; failures: number }, []>(
					"SELECT disabled, failures FROM accounts",
				)
				.get(),
		).toEqual({
			disabled: 0,
			failures: 0,
		});
	});

	test("returns the cached database for repeated opens", () => {
		const path = tempDb();
		const first = openBalancerDatabase(path);
		const second = openBalancerDatabase(path);

		expect(second).toBe(first);
	});

	test("configures sqlite busy timeout for lock contention retries", () => {
		const db = openBalancerDatabase(tempDb());
		const row = db.query<{ timeout: number }, []>("PRAGMA busy_timeout").get();
		expect(row?.timeout).toBe(5000);
	});

	test("opens a new usable database after closing the cached handle", () => {
		const path = tempDb();
		const db = openBalancerDatabase(path);
		migrate(db);
		closeBalancerDatabase(path);

		const reopened = openBalancerDatabase(path);
		migrate(reopened);

		expect(reopened).not.toBe(db);
		const row = reopened
			.query<{ version: number }, []>("SELECT version FROM schema_migrations")
			.get();
		expect(row?.version).toBe(1);
	});

	test("reopens a usable database after the cached handle is closed", () => {
		const path = tempDb();
		const db = openBalancerDatabase(path);
		db.close();

		const reopened = openBalancerDatabase(path);
		migrate(reopened);

		const row = reopened
			.query<{ version: number }, []>("SELECT version FROM schema_migrations")
			.get();
		expect(row?.version).toBe(1);
	});

	test("does not cache handles when permission hardening fails", () => {
		if (process.platform === "win32" || process.getuid?.() === 0) return;

		const path = "/dev/null";

		try {
			expect(() => openBalancerDatabase(path)).toThrow();
			expect(() => openBalancerDatabase(path)).toThrow();
		} finally {
			closeBalancerDatabase(path);
		}
	});

	test("ignores missing database files when securing permissions", () => {
		expect(() => secureDatabaseFiles(tempDb())).not.toThrow();
	});

	test("rethrows non-missing chmod errors when securing permissions", () => {
		const dir = mkdtempSync(join(tmpdir(), "opencode-balancer-"));
		dirs.push(dir);
		const file = join(dir, "not-a-directory");
		writeFileSync(file, "");

		expect(() => secureDatabaseFiles(join(file, "balancer.sqlite"))).toThrow();
	});
});
