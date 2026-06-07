import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getActiveAccount, saveAccount, setActiveAccount, setSelectedModel } from "../../src/core/accounts";
import { closeBalancerDatabase, openBalancerDatabase } from "../../src/core/database";
import { markNativeConnectInProgress } from "../../src/core/native-connect";
import { setBalancingEnabled, setProviderModel } from "../../src/core/priority";
import { migrate } from "../../src/core/schema";
import type { AuthInfo } from "../../src/core/types";
import {
    __testClearPendingRequests,
    __testGetPendingRequest,
    INTERNAL_REQUEST_HEADER,
} from "../../src/server/request-balancer";
import { configureFallbackCommand, createServerHooks } from "../../src/server/index";

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
    delete Bun.env.OPENCODE_AUTH_CONTENT;
    for (const path of paths) closeBalancerDatabase(path);
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
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
        const hooks = createServerHooks({ db: db(), client: {} });

        expect(hooks.config).toBeFunction();
        expect(hooks["chat.headers"]).toBeFunction();
        expect(hooks["command.execute.before"]).toBeFunction();
        expect(hooks["experimental.chat.messages.transform"]).toBeFunction();
        expect(hooks.tool?.balancer_command).toBeDefined();
    });

    test("chat headers marks requests for active accounts", async () => {
        const database = db();
        saveAccount(database, "openai", "main", { type: "api", key: "sk-main" });
        const hooks = createServerHooks({ db: database, client: {} });
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
            type: "oauth",
            refresh: "active-refresh",
            access: "active-access",
            expires: Date.now() + 60_000,
        } satisfies AuthInfo;
        const connected = {
            type: "oauth",
            refresh: "connected-refresh",
            access: "connected-access",
            expires: Date.now() + 60_000,
        } satisfies AuthInfo;
        saveAccount(database, "openai", "active", active);
        markNativeConnectInProgress(database);
        Bun.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ openai: connected });
        const setCalls: unknown[] = [];
        const hooks = createServerHooks({
            db: database,
            client: {
                auth: {
                    set: async (input: unknown) => setCalls.push(input),
                },
            },
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
        saveAccount(database, "openai", "op1", { type: "api", key: "sk-openai-test" });
        saveAccount(database, "github-copilot", "gh1", {
            type: "oauth",
            refresh: "refresh",
            access: "access",
            expires: Date.now() + 1000,
        });
        setActiveAccount(database, "github-copilot", "gh1");
        setSelectedModel(database, "github-copilot", "claude-haiku-4.5");
        const hooks = createServerHooks({ db: database, client: {} });
        const output = {
            message: {
                model: undefined as undefined | { providerID: string; modelID: string },
            },
            parts: [],
        };

        await hooks["chat.message"]?.({ sessionID: "ses", agent: "build" } as any, output as any);

        expect(output.message.model).toEqual({ providerID: "github-copilot", modelID: "claude-haiku-4.5" });
    });

    test("chat message preserves opencode's native selected model", async () => {
        const database = db();
        saveAccount(database, "github-copilot", "gh1", {
            type: "oauth",
            refresh: "refresh",
            access: "access",
            expires: Date.now() + 1000,
        });
        setActiveAccount(database, "github-copilot", "gh1");
        setSelectedModel(database, "github-copilot", "claude-haiku-4.5");
        const hooks = createServerHooks({ db: database, client: {} });
        const output = {
            message: {
                model: { providerID: "openai", modelID: "gpt-5.5" },
            },
            parts: [],
        };

        await hooks["chat.message"]?.({ sessionID: "ses", agent: "build" } as any, output as any);

        expect(output.message.model).toEqual({ providerID: "openai", modelID: "gpt-5.5" });
    });

    test("chat message keeps the current provider when balancing can select a healthy account there", async () => {
        const database = db();
        saveAccount(database, "github-copilot", "gh1", {
            type: "oauth",
            refresh: "refresh",
            access: "access",
            expires: Date.now() + 1000,
        });
        saveAccount(database, "openai", "op1", { type: "api", key: "sk" });
        setProviderModel(database, "github-copilot", "gemini-2.5-pro");
        setProviderModel(database, "openai", "gpt-5.5");
        setBalancingEnabled(database, true);
        const hooks = createServerHooks({ db: database, client: {} });
        const output = {
            message: { model: { providerID: "openai", modelID: "gpt-5.5" } },
            parts: [],
        };

        await hooks["chat.message"]?.({ sessionID: "ses", agent: "build" } as any, output as any);

        expect(output.message.model).toEqual({ providerID: "openai", modelID: "gpt-5.5" });
        expect(getActiveAccount(database, "openai")?.alias).toBe("op1");
    });

    test("chat message falls over to the next provider when the top one is rate limited (balancing on)", async () => {
        const database = db();
        saveAccount(database, "github-copilot", "gh1", {
            type: "oauth",
            refresh: "refresh",
            access: "access",
            expires: Date.now() + 1000,
        });
        saveAccount(database, "openai", "op1", { type: "api", key: "sk" });
        setProviderModel(database, "github-copilot", "gemini-2.5-pro");
        setProviderModel(database, "openai", "gpt-5.5");
        setBalancingEnabled(database, true);
        database.query("UPDATE accounts SET rate_limited_until = ? WHERE provider_id = 'github-copilot'").run(Date.now() + 60_000);
        const hooks = createServerHooks({ db: database, client: {} });
        const output = { message: { model: undefined as undefined | { providerID: string; modelID: string } }, parts: [] };

        await hooks["chat.message"]?.({ sessionID: "ses", agent: "build" } as any, output as any);

        expect(output.message.model).toEqual({ providerID: "openai", modelID: "gpt-5.5" });
    });

    test("balancer use reports missing accounts through fallback command output", async () => {
        const hooks = createServerHooks({ db: db(), client: {} });

        await expect(
            hooks["command.execute.before"]?.(
                { command: "balancer", arguments: "use openai missing" } as any,
                { parts: [] } as any,
            ),
        ).rejects.toThrow("[balancer]\nAccount not found: openai/missing");
    });
});
