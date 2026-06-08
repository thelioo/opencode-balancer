import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getActiveAccount,
	saveAccount,
	setActiveAccount,
	setSelectedModel,
} from "../../src/core/accounts";
import {
	closeBalancerDatabase,
	openBalancerDatabase,
} from "../../src/core/database";
import { markNativeConnectInProgress } from "../../src/core/native-connect";
import { setBalancingEnabled, setProviderModel } from "../../src/core/priority";
import { migrate } from "../../src/core/schema";
import type { AuthInfo } from "../../src/core/types";
import {
	__testClearSessionSelections,
	configureFallbackCommand,
	createServerHooks,
} from "../../src/server/index";
import {
	__testClearPendingRequests,
	__testGetPendingRequest,
	INTERNAL_REQUEST_HEADER,
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
	__testClearPendingRequests();
	__testClearSessionSelections();
	delete Bun.env.OPENCODE_AUTH_CONTENT;
	for (const path of paths) closeBalancerDatabase(path);
	for (const dir of dirs) rmSync(dir, { force: true, recursive: true });
	dirs = [];
	paths = [];
});

describe("server plugin config", () => {
	test("preserves an existing balancer command", () => {
		const command = {
			description: "Custom balancer command",
			template: "Run a custom balancer command: $ARGUMENTS",
		};
		const cfg = { command: { balancer: command } };

		configureFallbackCommand(cfg);

		expect(cfg.command.balancer).toBe(command);
	});

	test("does not create a second default balancer slash command", () => {
		const cfg = {};

		configureFallbackCommand(cfg);

		expect(cfg).toEqual({});
	});

	test("creates fallback balancer hooks and tool", () => {
		const hooks = createServerHooks({ client: {}, db: db() });

		expect(hooks.config).toBeFunction();
		expect(hooks["chat.headers"]).toBeFunction();
		expect(hooks["command.execute.before"]).toBeFunction();
		expect(hooks["experimental.chat.messages.transform"]).toBeFunction();
		expect(hooks.tool?.balancer_command).toBeDefined();
	});

	test("chat headers marks requests for active accounts", async () => {
		const database = db();
		saveAccount(database, "openai", "main", { key: "sk-main", type: "api" });
		const hooks = createServerHooks({ client: {}, db: database });
		const output = { headers: {} as Record<string, string> };

		await hooks["chat.headers"]?.(
			{ model: { providerID: "openai" } } as any,
			output,
		);

		const requestID = output.headers[INTERNAL_REQUEST_HEADER];
		expect(requestID).toBeString();
		expect(__testGetPendingRequest(requestID)?.account?.alias).toBe("main");
	});

	test("chat headers does not overwrite native auth while provider connect is in progress", async () => {
		const database = db();
		const active = {
			access: "active-access",
			expires: Date.now() + 60_000,
			refresh: "active-refresh",
			type: "oauth",
		} satisfies AuthInfo;
		const connected = {
			access: "connected-access",
			expires: Date.now() + 60_000,
			refresh: "connected-refresh",
			type: "oauth",
		} satisfies AuthInfo;
		saveAccount(database, "openai", "active", active);
		markNativeConnectInProgress(database);
		Bun.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ openai: connected });
		const setCalls: unknown[] = [];
		const hooks = createServerHooks({
			client: {
				auth: {
					set: async (input: unknown) => setCalls.push(input),
				},
			},
			db: database,
		});
		const output = { headers: {} as Record<string, string> };

		await hooks["chat.headers"]?.(
			{ model: { providerID: "openai" } } as any,
			output,
		);

		expect(setCalls).toEqual([]);
		expect(output.headers[INTERNAL_REQUEST_HEADER]).toBeString();
	});

	test("chat message fills the selected provider model only when opencode did not set one", async () => {
		const database = db();
		saveAccount(database, "openai", "op1", {
			key: "sk-openai-test",
			type: "api",
		});
		saveAccount(database, "github-copilot", "gh1", {
			access: "access",
			expires: Date.now() + 1000,
			refresh: "refresh",
			type: "oauth",
		});
		setActiveAccount(database, "github-copilot", "gh1");
		setSelectedModel(database, "github-copilot", "claude-haiku-4.5");
		const hooks = createServerHooks({ client: {}, db: database });
		const output = {
			message: {
				model: undefined as undefined | { providerID: string; modelID: string },
			},
			parts: [],
		};

		await hooks["chat.message"]?.(
			{ agent: "build", sessionID: "ses" } as any,
			output as any,
		);

		expect(output.message.model).toEqual({
			modelID: "claude-haiku-4.5",
			providerID: "github-copilot",
		});
	});

	test("chat message preserves opencode's native selected model", async () => {
		const database = db();
		saveAccount(database, "github-copilot", "gh1", {
			access: "access",
			expires: Date.now() + 1000,
			refresh: "refresh",
			type: "oauth",
		});
		setActiveAccount(database, "github-copilot", "gh1");
		setSelectedModel(database, "github-copilot", "claude-haiku-4.5");
		const hooks = createServerHooks({ client: {}, db: database });
		const output = {
			message: {
				model: { modelID: "gpt-5.5", providerID: "openai" },
			},
			parts: [],
		};

		await hooks["chat.message"]?.(
			{ agent: "build", sessionID: "ses" } as any,
			output as any,
		);

		expect(output.message.model).toEqual({
			modelID: "gpt-5.5",
			providerID: "openai",
		});
	});

	test("chat message keeps the current provider when balancing can select a healthy account there", async () => {
		const database = db();
		saveAccount(database, "github-copilot", "gh1", {
			access: "access",
			expires: Date.now() + 1000,
			refresh: "refresh",
			type: "oauth",
		});
		saveAccount(database, "openai", "op1", { key: "sk", type: "api" });
		setProviderModel(database, "github-copilot", "gemini-2.5-pro");
		setProviderModel(database, "openai", "gpt-5.5");
		setBalancingEnabled(database, true);
		const hooks = createServerHooks({ client: {}, db: database });
		const output = {
			message: { model: { modelID: "gpt-5.5", providerID: "openai" } },
			parts: [],
		};

		await hooks["chat.message"]?.(
			{ agent: "build", sessionID: "ses" } as any,
			output as any,
		);

		expect(output.message.model).toEqual({
			modelID: "gpt-5.5",
			providerID: "openai",
		});
		expect(getActiveAccount(database, "openai")?.alias).toBe("op1");
	});

	test("chat message keeps the same account for the same session while it stays healthy", async () => {
		const database = db();
		saveAccount(database, "github-copilot", "gh1", {
			access: "access",
			expires: Date.now() + 1000,
			refresh: "refresh",
			type: "oauth",
		});
		saveAccount(database, "openai", "op1", { key: "sk", type: "api" });
		setProviderModel(database, "github-copilot", "gemini-2.5-pro");
		setProviderModel(database, "openai", "gpt-5.5");
		setBalancingEnabled(database, true);
		const hooks = createServerHooks({ client: {}, db: database });
		const first = {
			message: { model: { modelID: "gpt-5.5", providerID: "openai" } },
			parts: [],
		};

		await hooks["chat.message"]?.(
			{ agent: "build", sessionID: "sticky-session" } as any,
			first as any,
		);
		expect(first.message.model).toEqual({
			modelID: "gpt-5.5",
			providerID: "openai",
		});

		const second = {
			message: {
				model: undefined as undefined | { providerID: string; modelID: string },
			},
			parts: [],
		};
		await hooks["chat.message"]?.(
			{ agent: "build", sessionID: "sticky-session" } as any,
			second as any,
		);

		expect(second.message.model).toEqual({
			modelID: "gpt-5.5",
			providerID: "openai",
		});
		expect(getActiveAccount(database, "openai")?.alias).toBe("op1");
	});

	test("chat message switches a sticky account when it becomes unavailable", async () => {
		const database = db();
		saveAccount(database, "github-copilot", "gh1", {
			access: "access",
			expires: Date.now() + 1000,
			refresh: "refresh",
			type: "oauth",
		});
		saveAccount(database, "openai", "op1", { key: "sk", type: "api" });
		setProviderModel(database, "github-copilot", "gemini-2.5-pro");
		setProviderModel(database, "openai", "gpt-5.5");
		setBalancingEnabled(database, true);
		const hooks = createServerHooks({ client: {}, db: database });
		const first = {
			message: { model: { modelID: "gpt-5.5", providerID: "openai" } },
			parts: [],
		};

		await hooks["chat.message"]?.(
			{ agent: "build", sessionID: "sticky-failover-session" } as any,
			first as any,
		);
		database
			.query(
				"UPDATE accounts SET rate_limited_until = ? WHERE provider_id = 'openai' AND alias = 'op1'",
			)
			.run(Date.now() + 60_000);

		const second = {
			message: {
				model: undefined as undefined | { providerID: string; modelID: string },
			},
			parts: [],
		};
		await hooks["chat.message"]?.(
			{ agent: "build", sessionID: "sticky-failover-session" } as any,
			second as any,
		);

		expect(second.message.model).toEqual({
			modelID: "gemini-2.5-pro",
			providerID: "github-copilot",
		});
		expect(getActiveAccount(database, "github-copilot")?.alias).toBe("gh1");
	});

	test("chat message falls over to the next provider when the top one is rate limited (balancing on)", async () => {
		const database = db();
		saveAccount(database, "github-copilot", "gh1", {
			access: "access",
			expires: Date.now() + 1000,
			refresh: "refresh",
			type: "oauth",
		});
		saveAccount(database, "openai", "op1", { key: "sk", type: "api" });
		setProviderModel(database, "github-copilot", "gemini-2.5-pro");
		setProviderModel(database, "openai", "gpt-5.5");
		setBalancingEnabled(database, true);
		database
			.query(
				"UPDATE accounts SET rate_limited_until = ? WHERE provider_id = 'github-copilot'",
			)
			.run(Date.now() + 60_000);
		const hooks = createServerHooks({ client: {}, db: database });
		const output = {
			message: {
				model: undefined as undefined | { providerID: string; modelID: string },
			},
			parts: [],
		};

		await hooks["chat.message"]?.(
			{ agent: "build", sessionID: "ses" } as any,
			output as any,
		);

		expect(output.message.model).toEqual({
			modelID: "gpt-5.5",
			providerID: "openai",
		});
	});

	test("balancer use reports missing accounts through fallback command output", async () => {
		const hooks = createServerHooks({ client: {}, db: db() });

		await expect(
			hooks["command.execute.before"]?.(
				{ arguments: "use openai missing", command: "balancer" } as any,
				{ parts: [] } as any,
			),
		).rejects.toThrow("[balancer]\nAccount not found: openai/missing");
	});
});
