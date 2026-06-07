import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getAccount,
	getActiveAccount,
	listAccounts,
	removeAccount,
	saveAccount,
	setActiveAccount,
} from "../../src/core/accounts";
import {
	closeBalancerDatabase,
	openBalancerDatabase,
} from "../../src/core/database";
import {
	claimPendingPrompt,
	completePendingConnection,
	createPendingConnection,
	listPendingConnections,
	removePendingConnection,
} from "../../src/core/pending";
import { migrate } from "../../src/core/schema";

let dirs: string[] = [];
let dbPaths: string[] = [];

function db() {
	const dir = mkdtempSync(join(tmpdir(), "opencode-balancer-"));
	dirs.push(dir);
	const path = join(dir, "balancer.sqlite");
	dbPaths.push(path);
	const database = openBalancerDatabase(path);
	migrate(database);
	return database;
}

function jwtWithChatGPTAccountID(accountID: string) {
	const payload = Buffer.from(
		JSON.stringify({
			"https://api.openai.com/auth": { chatgpt_account_id: accountID },
		}),
	).toString("base64url");
	return `header.${payload}.signature`;
}

afterEach(() => {
	for (const path of dbPaths) closeBalancerDatabase(path);
	for (const dir of dirs) rmSync(dir, { force: true, recursive: true });
	dirs = [];
	dbPaths = [];
});

describe("accounts and pending connections", () => {
	test("saves a pending connection as an active account", () => {
		const database = db();
		const pending = createPendingConnection(
			database,
			"anthropic",
			{ key: "sk-ant-test", type: "api" },
			"http",
		);
		const account = completePendingConnection(
			database,
			pending.id,
			"Work Account",
		);

		expect(account.alias).toBe("work-account");
		expect(listPendingConnections(database)).toHaveLength(0);
		expect(getActiveAccount(database, "anthropic")?.alias).toBe("work-account");
	});

	test("deduplicates equivalent pending connections from concurrent watchers", () => {
		const database = db();
		const auth = {
			access: "a",
			expires: 123,
			refresh: "r",
			type: "oauth" as const,
		};

		const first = createPendingConnection(
			database,
			"openai",
			auth,
			"auth-file",
		);
		const second = createPendingConnection(
			database,
			"openai",
			auth,
			"auth-file",
		);

		expect(second.id).toBe(first.id);
		expect(listPendingConnections(database)).toHaveLength(1);
	});

	test("deduplicates oauth pending connections when only access token fields changed", () => {
		const database = db();
		const first = createPendingConnection(
			database,
			"openai",
			{ access: "a1", expires: 123, refresh: "r", type: "oauth" },
			"auth-file",
		);
		const second = createPendingConnection(
			database,
			"openai",
			{ access: "a2", expires: 456, refresh: "r", type: "oauth" },
			"auth-file",
		);

		expect(second.id).toBe(first.id);
		expect(listPendingConnections(database)).toHaveLength(1);
	});

	test("deduplicates oauth pending connections by token account id when refresh token changes", () => {
		const database = db();
		const first = createPendingConnection(
			database,
			"openai",
			{
				access: jwtWithChatGPTAccountID("acct-1"),
				expires: 123,
				refresh: "r1",
				type: "oauth",
			},
			"auth-file",
		);
		const second = createPendingConnection(
			database,
			"openai",
			{
				access: jwtWithChatGPTAccountID("acct-1"),
				expires: 456,
				refresh: "r2",
				type: "oauth",
			},
			"auth-file",
		);

		expect(second.id).toBe(first.id);
		expect(listPendingConnections(database)).toHaveLength(1);
	});

	test("claimPendingPrompt marks equivalent pending rows so another instance cannot prompt again", () => {
		const database = db();
		const auth = {
			access: "a",
			expires: 123,
			refresh: "r",
			type: "oauth" as const,
		};
		const first = createPendingConnection(
			database,
			"openai",
			auth,
			"auth-file",
		);
		database
			.query(
				`INSERT INTO pending_connections (
                     id, provider_id, auth_json, auth_type, source, captured_at, prompt_status
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"legacy-duplicate",
				"openai",
				JSON.stringify(auth),
				"oauth",
				"auth-file",
				Date.now(),
				"new",
			);

		expect(claimPendingPrompt(database, first.id)?.id).toBe(first.id);
		expect(claimPendingPrompt(database, "legacy-duplicate")).toBeUndefined();
		expect(
			listPendingConnections(database).map((pending) => pending.promptStatus),
		).toEqual(["prompted", "prompted"]);
	});

	test("claimPendingPrompt marks oauth duplicate rows with refreshed access tokens", () => {
		const database = db();
		const first = createPendingConnection(
			database,
			"openai",
			{ access: "a1", expires: 123, refresh: "r", type: "oauth" },
			"auth-file",
		);
		database
			.query(
				`INSERT INTO pending_connections (
                     id, provider_id, auth_json, auth_type, source, captured_at, prompt_status
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"legacy-refreshed",
				"openai",
				JSON.stringify({
					access: "a2",
					expires: 456,
					refresh: "r",
					type: "oauth",
				}),
				"oauth",
				"auth-file",
				Date.now(),
				"new",
			);

		expect(claimPendingPrompt(database, first.id)?.id).toBe(first.id);
		expect(claimPendingPrompt(database, "legacy-refreshed")).toBeUndefined();
		expect(
			listPendingConnections(database).map((pending) => pending.promptStatus),
		).toEqual(["prompted", "prompted"]);
	});

	test("completePendingConnection removes equivalent duplicate pending rows", () => {
		const database = db();
		const auth = {
			access: "a",
			expires: 123,
			refresh: "r",
			type: "oauth" as const,
		};
		const first = createPendingConnection(
			database,
			"openai",
			auth,
			"auth-file",
		);
		database
			.query(
				`INSERT INTO pending_connections (
                     id, provider_id, auth_json, auth_type, source, captured_at, prompt_status
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"legacy-duplicate",
				"openai",
				JSON.stringify(auth),
				"oauth",
				"auth-file",
				Date.now(),
				"new",
			);

		completePendingConnection(database, first.id, "main");

		expect(listPendingConnections(database)).toEqual([]);
	});

	test("completePendingConnection removes oauth duplicate rows with refreshed access tokens", () => {
		const database = db();
		const first = createPendingConnection(
			database,
			"openai",
			{ access: "a1", expires: 123, refresh: "r", type: "oauth" },
			"auth-file",
		);
		database
			.query(
				`INSERT INTO pending_connections (
                     id, provider_id, auth_json, auth_type, source, captured_at, prompt_status
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"legacy-refreshed",
				"openai",
				JSON.stringify({
					access: "a2",
					expires: 456,
					refresh: "r",
					type: "oauth",
				}),
				"oauth",
				"auth-file",
				Date.now(),
				"new",
			);

		completePendingConnection(database, first.id, "main");

		expect(listPendingConnections(database)).toEqual([]);
	});

	test("switches active account", () => {
		const database = db();
		saveAccount(database, "openai", "main", { key: "sk-main", type: "api" });
		saveAccount(database, "openai", "backup", {
			key: "sk-backup",
			type: "api",
		});
		setActiveAccount(database, "openai", "main");

		expect(getActiveAccount(database, "openai")?.alias).toBe("main");
		expect(listAccounts(database, "openai")).toHaveLength(2);
	});

	test("removes an account and moves active state to another account", () => {
		const database = db();
		saveAccount(database, "openai", "main", { key: "sk-main", type: "api" });
		saveAccount(database, "openai", "backup", {
			key: "sk-backup",
			type: "api",
		});
		setActiveAccount(database, "openai", "main");

		expect(removeAccount(database, "openai", "main")).toBe(true);

		expect(getAccount(database, "openai", "main")).toBeUndefined();
		expect(getActiveAccount(database, "openai")?.alias).toBe("backup");
		expect(removeAccount(database, "openai", "missing")).toBe(false);
	});

	test("dismisses a pending connection so native auth does not recreate it", () => {
		const database = db();
		const auth = { key: "sk-ant-test", type: "api" } as const;
		const pending = createPendingConnection(
			database,
			"anthropic",
			auth,
			"auth-file",
		);

		expect(removePendingConnection(database, pending.id)).toBe(true);

		expect(listPendingConnections(database)).toMatchObject([
			{ id: pending.id, promptStatus: "dismissed" },
		]);
		expect(
			createPendingConnection(database, "anthropic", auth, "auth-file"),
		).toMatchObject({
			id: pending.id,
			promptStatus: "dismissed",
		});
		expect(removePendingConnection(database, pending.id)).toBe(false);
	});

	test("rolls back account save when active state write fails", () => {
		const database = db();
		database.exec(`
            CREATE TRIGGER fail_provider_state_insert
            BEFORE INSERT ON provider_state
            BEGIN
                SELECT RAISE(ABORT, 'provider state write failed');
            END;
        `);

		expect(() =>
			saveAccount(database, "openai", "main", { key: "sk-main", type: "api" }),
		).toThrow("provider state write failed");
		expect(listAccounts(database, "openai")).toHaveLength(0);
	});

	test("rejects account rows with mismatched auth types", () => {
		const database = db();
		database
			.query(
				`INSERT INTO accounts (
                     provider_id,
                     alias,
                     auth_json,
                     auth_type,
                     created_at,
                     updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"openai",
				"main",
				JSON.stringify({ key: "sk-main", type: "api" }),
				"oauth",
				Date.now(),
				Date.now(),
			);

		expect(() => getAccount(database, "openai", "main")).toThrow(
			"Invalid account row for openai/main: auth_type oauth does not match auth_json type api",
		);
	});

	test("rejects pending rows with invalid sources", () => {
		const database = db();
		database
			.query(
				`INSERT INTO pending_connections (
                     id,
                     provider_id,
                     auth_json,
                     auth_type,
                     source,
                     captured_at,
                     prompt_status
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"pending-invalid-source",
				"openai",
				JSON.stringify({ key: "sk-main", type: "api" }),
				"api",
				"invalid-source",
				Date.now(),
				"new",
			);

		expect(() => listPendingConnections(database)).toThrow(
			"Invalid pending connection row pending-invalid-source: source invalid-source is invalid",
		);
	});

	test("rejects pending rows with invalid prompt statuses", () => {
		const database = db();
		database
			.query(
				`INSERT INTO pending_connections (
                     id,
                     provider_id,
                     auth_json,
                     auth_type,
                     source,
                     captured_at,
                     prompt_status
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"pending-invalid-status",
				"openai",
				JSON.stringify({ key: "sk-main", type: "api" }),
				"api",
				"http",
				Date.now(),
				"invalid-status",
			);

		expect(() => listPendingConnections(database)).toThrow(
			"Invalid pending connection row pending-invalid-status: prompt_status invalid-status is invalid",
		);
	});

	test("rejects pending rows with mismatched auth types", () => {
		const database = db();
		database
			.query(
				`INSERT INTO pending_connections (
                     id,
                     provider_id,
                     auth_json,
                     auth_type,
                     source,
                     captured_at,
                     prompt_status
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"pending-mismatched-auth-type",
				"openai",
				JSON.stringify({ key: "sk-main", type: "api" }),
				"oauth",
				"http",
				Date.now(),
				"new",
			);

		expect(() => listPendingConnections(database)).toThrow(
			"Invalid pending connection row pending-mismatched-auth-type: auth_type oauth does not match auth_json type api",
		);
	});

	test("rejects pending rows with invalid auth types", () => {
		const database = db();
		database
			.query(
				`INSERT INTO pending_connections (
                     id,
                     provider_id,
                     auth_json,
                     auth_type,
                     source,
                     captured_at,
                     prompt_status
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"pending-invalid-auth-type",
				"openai",
				JSON.stringify({ key: "sk-main", type: "api" }),
				"invalid-auth",
				"http",
				Date.now(),
				"new",
			);

		expect(() => listPendingConnections(database)).toThrow(
			"Invalid pending connection row pending-invalid-auth-type: auth_type invalid-auth is invalid",
		);
	});
});
