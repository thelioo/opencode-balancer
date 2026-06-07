import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAccount, saveAccount } from "../../src/core/accounts";
import {
	closeBalancerDatabase,
	openBalancerDatabase,
} from "../../src/core/database";
import { setBalancingEnabled } from "../../src/core/priority";
import { migrate } from "../../src/core/schema";
import {
	__testResetFetchPatch,
	installFetchPatch,
} from "../../src/server/fetch-patch";
import {
	__testClearPendingRequests,
	INTERNAL_REQUEST_HEADER,
	setPendingRequest,
} from "../../src/server/request-balancer";

let dirs: string[] = [];
let paths: string[] = [];
const originalFetch = globalThis.fetch;

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
	globalThis.fetch = originalFetch;
	__testResetFetchPatch();
	__testClearPendingRequests();
	for (const path of paths) closeBalancerDatabase(path);
	for (const dir of dirs) rmSync(dir, { force: true, recursive: true });
	dirs = [];
	paths = [];
});

describe("server fetch patch", () => {
	test("keeps a fresh native oauth authorization header instead of restoring a stale saved access token", async () => {
		const database = db();
		const account = saveAccount(database, "openai", "main", {
			access: "stale-saved-access",
			expires: Date.now() - 1000,
			refresh: "refresh-token",
			type: "oauth",
		});
		setPendingRequest("request-1", { account, providerID: "openai" });

		let attemptedAuthorization: string | null = null;
		globalThis.fetch = (async (
			_input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const headers = new Headers(init?.headers);
			attemptedAuthorization = headers.get("authorization");
			return new Response("ok", { status: 200 });
		}) as typeof fetch;
		installFetchPatch(database, {});

		const response = await fetch("https://api.example.test/v1/chat", {
			headers: {
				[INTERNAL_REQUEST_HEADER]: "request-1",
				authorization: "Bearer fresh-native-access",
			},
		});

		expect(response.status).toBe(200);
		expect(attemptedAuthorization as unknown).toBe(
			"Bearer fresh-native-access",
		);
	});

	test("overrides oauth authorization on failover attempts so the retry uses the next account", async () => {
		const database = db();
		setBalancingEnabled(database, true);
		const main = saveAccount(database, "openai", "main", {
			access: "main-access",
			expires: Date.now() + 60_000,
			refresh: "main-refresh",
			type: "oauth",
		});
		saveAccount(database, "openai", "backup", {
			access: "backup-access",
			expires: Date.now() + 60_000,
			refresh: "backup-refresh",
			type: "oauth",
		});
		setPendingRequest("request-1", { account: main, providerID: "openai" });

		const attemptedAuthorizations: string[] = [];
		globalThis.fetch = (async (
			_input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const headers = new Headers(init?.headers);
			attemptedAuthorizations.push(headers.get("authorization") ?? "");
			return new Response(
				attemptedAuthorizations.length === 1 ? "rate limited" : "ok",
				{
					status: attemptedAuthorizations.length === 1 ? 429 : 200,
				},
			);
		}) as typeof fetch;
		installFetchPatch(database, { auth: { set: async () => undefined } });

		const response = await fetch("https://api.example.test/v1/chat", {
			headers: {
				[INTERNAL_REQUEST_HEADER]: "request-1",
				authorization: "Bearer main-native-access",
			},
		});

		expect(response.status).toBe(200);
		expect(attemptedAuthorizations).toEqual([
			"Bearer main-native-access",
			"Bearer backup-access",
		]);
	});

	test("bounds failover retries and marks each retryable attempt", async () => {
		const database = db();
		setBalancingEnabled(database, true);
		const main = saveAccount(database, "openai", "main", {
			key: "sk-main",
			type: "api",
		});
		saveAccount(database, "openai", "backup-1", {
			key: "sk-backup-1",
			type: "api",
		});
		saveAccount(database, "openai", "backup-2", {
			key: "sk-backup-2",
			type: "api",
		});
		saveAccount(database, "openai", "backup-3", {
			key: "sk-backup-3",
			type: "api",
		});
		setPendingRequest("request-1", { account: main, providerID: "openai" });

		const attemptedKeys: string[] = [];
		globalThis.fetch = (async (
			_input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const headers = new Headers(init?.headers);
			attemptedKeys.push(
				headers.get("authorization")?.replace(/^Bearer /, "") ?? "",
			);
			expect(headers.has(INTERNAL_REQUEST_HEADER)).toBe(false);
			return new Response("rate limited", { status: 429 });
		}) as typeof fetch;
		installFetchPatch(database, {});

		const response = await fetch("https://api.example.test/v1/chat", {
			headers: { [INTERNAL_REQUEST_HEADER]: "request-1" },
		});

		expect(response.status).toBe(429);
		expect(attemptedKeys).toEqual(["sk-main", "sk-backup-1", "sk-backup-2"]);
		expect(getAccount(database, "openai", "main")?.failures).toBe(1);
		expect(getAccount(database, "openai", "backup-1")?.failures).toBe(1);
		expect(getAccount(database, "openai", "backup-2")?.failures).toBe(1);
		expect(getAccount(database, "openai", "backup-3")?.failures).toBe(0);
	});

	test("does not fail over or write native auth when balancing is disabled", async () => {
		const database = db();
		const main = saveAccount(database, "openai", "main", {
			key: "sk-main",
			type: "api",
		});
		saveAccount(database, "openai", "backup", {
			key: "sk-backup",
			type: "api",
		});
		setPendingRequest("request-1", { account: main, providerID: "openai" });

		const attemptedKeys: string[] = [];
		const authSets: unknown[] = [];
		const toasts: unknown[] = [];
		globalThis.fetch = (async (
			_input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const headers = new Headers(init?.headers);
			attemptedKeys.push(
				headers.get("authorization")?.replace(/^Bearer /, "") ?? "",
			);
			return new Response("rate limited", { status: 429 });
		}) as typeof fetch;
		installFetchPatch(database, {
			auth: { set: async (input: unknown) => authSets.push(input) },
			tui: { showToast: async (input: unknown) => toasts.push(input) },
		});

		const response = await fetch("https://api.example.test/v1/chat", {
			headers: { [INTERNAL_REQUEST_HEADER]: "request-1" },
		});

		expect(response.status).toBe(429);
		expect(attemptedKeys).toEqual(["sk-main"]);
		expect(authSets).toEqual([]);
		expect(toasts).toEqual([]);
		expect(getAccount(database, "openai", "main")?.failures).toBe(1);
		expect(getAccount(database, "openai", "backup")?.failures).toBe(0);
	});
});
