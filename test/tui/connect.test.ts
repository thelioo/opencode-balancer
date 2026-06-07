import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getActiveAccount, listAccounts } from "../../src/core/accounts";
import {
	closeBalancerDatabase,
	openBalancerDatabase,
} from "../../src/core/database";
import { isNativeConnectInProgress } from "../../src/core/native-connect";
import { migrate } from "../../src/core/schema";
import type { AuthInfo } from "../../src/core/types";
import { openNativeConnect } from "../../src/tui/connect";

describe("openNativeConnect", () => {
	test("dispatches the native provider connect command", async () => {
		const commands: string[] = [];

		await openNativeConnect({
			keymap: {
				dispatchCommand: (command: string) => commands.push(command),
			},
			ui: { toast: () => {} },
		});

		expect(commands).toEqual(["provider.connect"]);
	});

	test("marks native connect in progress only while dispatching", async () => {
		const dir = mkdtempSync(join(tmpdir(), "opencode-balancer-connect-"));
		const path = join(dir, "balancer.sqlite");
		const db = openBalancerDatabase(path);
		migrate(db);
		const commands: string[] = [];

		await openNativeConnect({
			db,
			keymap: {
				dispatchCommand: (command: string) => {
					commands.push(command);
					expect(isNativeConnectInProgress(db)).toBe(true);
				},
			},
			ui: { toast: () => {} },
		});

		expect(commands).toEqual(["provider.connect"]);
		expect(isNativeConnectInProgress(db)).toBe(false);
		closeBalancerDatabase(path);
		rmSync(dir, { force: true, recursive: true });
	});

	test("saves changed native auth with a generated 5 character alias after connect", async () => {
		const dir = mkdtempSync(join(tmpdir(), "opencode-balancer-connect-"));
		const path = join(dir, "balancer.sqlite");
		const db = openBalancerDatabase(path);
		migrate(db);
		const before = {
			access: "old",
			expires: 1,
			refresh: "old",
			type: "oauth",
		} satisfies AuthInfo;
		const after = {
			access: "new",
			expires: 2,
			refresh: "new",
			type: "oauth",
		} satisfies AuthInfo;
		const toasts: unknown[] = [];
		let reads = 0;

		await openNativeConnect({
			db,
			generateAlias: () => "a1b2c",
			keymap: {
				dispatchCommand: async () => undefined,
			},
			readAuth: () => ({
				auth: { openai: reads++ === 0 ? before : after },
				ok: true,
			}),
			ui: { toast: (input: unknown) => toasts.push(input) },
		});

		expect(listAccounts(db, "openai")).toMatchObject([
			{ alias: "a1b2c", auth: after, providerID: "openai" },
		]);
		expect(getActiveAccount(db, "openai")?.alias).toBe("a1b2c");
		expect(isNativeConnectInProgress(db)).toBe(false);
		expect(toasts).toEqual([
			{ message: "Saved openai/a1b2c.", variant: "success" },
		]);
		closeBalancerDatabase(path);
		rmSync(dir, { force: true, recursive: true });
	});

	test("waits for native auth to change after the provider dialog finishes later", async () => {
		const dir = mkdtempSync(join(tmpdir(), "opencode-balancer-connect-"));
		const path = join(dir, "balancer.sqlite");
		const db = openBalancerDatabase(path);
		migrate(db);
		const before = {
			access: "old",
			expires: 1,
			refresh: "old",
			type: "oauth",
		} satisfies AuthInfo;
		const after = {
			access: "new",
			expires: 2,
			refresh: "new",
			type: "oauth",
		} satisfies AuthInfo;
		let reads = 0;

		await openNativeConnect({
			db,
			generateAlias: () => "d4e5f",
			keymap: {
				dispatchCommand: async () => undefined,
			},
			maxWaitMs: 100,
			pollIntervalMs: 10,
			readAuth: () => ({
				auth: { openai: reads++ < 3 ? before : after },
				ok: true,
			}),
			ui: { toast: () => {} },
			wait: async () => undefined,
		});

		expect(listAccounts(db, "openai")).toMatchObject([
			{ alias: "d4e5f", auth: after, providerID: "openai" },
		]);
		closeBalancerDatabase(path);
		rmSync(dir, { force: true, recursive: true });
	});

	test("updates an existing native account instead of saving the same oauth account again", async () => {
		const dir = mkdtempSync(join(tmpdir(), "opencode-balancer-connect-"));
		const path = join(dir, "balancer.sqlite");
		const db = openBalancerDatabase(path);
		migrate(db);
		const saved = {
			access: "old-access",
			expires: 1,
			refresh: "same-refresh",
			type: "oauth",
		} satisfies AuthInfo;
		const refreshed = {
			access: "new-access",
			expires: 2,
			refresh: "same-refresh",
			type: "oauth",
		} satisfies AuthInfo;
		let firstReads = 0;
		let secondReads = 0;

		await openNativeConnect({
			db,
			generateAlias: () => "first",
			keymap: {
				dispatchCommand: async () => undefined,
			},
			readAuth: () => ({
				auth: firstReads++ === 0 ? {} : { openai: saved },
				ok: true,
			}),
			ui: { toast: () => {} },
		});

		await openNativeConnect({
			db,
			generateAlias: () => "second",
			keymap: {
				dispatchCommand: async () => undefined,
			},
			readAuth: () => ({
				auth: { openai: secondReads++ === 0 ? saved : refreshed },
				ok: true,
			}),
			ui: { toast: () => {} },
		});

		expect(listAccounts(db, "openai")).toMatchObject([
			{ alias: "first", auth: refreshed, providerID: "openai" },
		]);
		expect(getActiveAccount(db, "openai")?.alias).toBe("first");
		closeBalancerDatabase(path);
		rmSync(dir, { force: true, recursive: true });
	});

	test("clears native connect progress when no auth is saved", async () => {
		const dir = mkdtempSync(join(tmpdir(), "opencode-balancer-connect-"));
		const path = join(dir, "balancer.sqlite");
		const db = openBalancerDatabase(path);
		migrate(db);
		const before = {
			access: "old",
			expires: 1,
			refresh: "old",
			type: "oauth",
		} satisfies AuthInfo;

		await openNativeConnect({
			db,
			keymap: {
				dispatchCommand: async () => undefined,
			},
			maxWaitMs: 0,
			readAuth: () => ({ auth: { openai: before }, ok: true }),
			ui: { toast: () => {} },
		});

		expect(isNativeConnectInProgress(db)).toBe(false);
		closeBalancerDatabase(path);
		rmSync(dir, { force: true, recursive: true });
	});

	test("shows an error toast when native connect is unavailable", () => {
		const toasts: unknown[] = [];

		openNativeConnect({
			keymap: {},
			ui: { toast: (input: unknown) => toasts.push(input) },
		});

		expect(toasts).toEqual([
			{
				message:
					"Native provider connect is unavailable in this opencode build.",
				variant: "error",
			},
		]);
	});
});
