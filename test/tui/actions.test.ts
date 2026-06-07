import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getActiveAccount, saveAccount, setSelectedModel } from "../../src/core/accounts";
import { closeBalancerDatabase, openBalancerDatabase } from "../../src/core/database";
import { listEvents } from "../../src/core/events";
import { createPendingConnection, listPendingConnections } from "../../src/core/pending";
import { migrate } from "../../src/core/schema";
import type { Account } from "../../src/core/types";
import { getUsageSnapshot } from "../../src/core/usage/store";
import type { ProviderUsageSnapshot } from "../../src/core/usage/types";
import { isNativeAuthCaptureSuppressed } from "../../src/core/native-auth-suppression";
import { activateAccount, refreshUsageForAccount, removeAccountFromTui, removePendingFromTui, renameAccountFromTui, savePendingAlias } from "../../src/tui/actions";
import type { BalancerTuiState } from "../../src/tui/state";

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

function createState(accounts: Account[] = []) {
    const dbPath = join(mkdtempSync(join(tmpdir(), "opencode-balancer-actions-")), "balancer.sqlite");
    dbPaths.push(dbPath);
    const db = openBalancerDatabase(dbPath);
    migrate(db);
    let refreshes = 0;
    let accountView = accounts;
    let pendingView: ReturnType<typeof listPendingConnections> = [];

    return {
        db,
        state: {
            db,
            version: () => 0,
            refresh: () => {
                refreshes += 1;
                accountView = accountView.filter((account) => Boolean(account));
                pendingView = listPendingConnections(db);
            },
            accounts: () => accountView,
            pending: () => pendingView,
            events: () => [],
            removeAccountView: (providerID, alias) => {
                accountView = accountView.filter((account) => account.providerID !== providerID || account.alias !== alias);
            },
            removePendingView: (pendingID) => {
                pendingView = pendingView.filter((pending) => pending.id !== pendingID);
            },
            dispose: () => closeBalancerDatabase(dbPath),
        } satisfies BalancerTuiState,
        refreshCount: () => refreshes,
    };
}

describe("tui actions", () => {
    test("savePendingAlias completes a pending connection and refreshes state", async () => {
        const { db, state, refreshCount } = createState();
        const pending = createPendingConnection(db, "anthropic", { type: "api", key: "sk-ant-test" }, "http");

        const account = await savePendingAlias(state, pending.id, "Work Account");

        expect(account.providerID).toBe("anthropic");
        expect(account.alias).toBe("work-account");
        expect(getActiveAccount(db, "anthropic")?.alias).toBe("work-account");
        expect(listPendingConnections(db)).toEqual([]);
        expect(refreshCount()).toBe(1);
    });

    test("activateAccount sets the active account, updates opencode auth, and refreshes state", async () => {
        const { db, state, refreshCount } = createState();
        const account = saveAccount(db, "openai", "work", { type: "api", key: "sk-openai-test" });
        saveAccount(db, "openai", "personal", { type: "api", key: "sk-openai-personal" });
        const calls: unknown[] = [];
        const toasts: unknown[] = [];
        const api = {
            client: {
                auth: {
                    set: async (input: unknown) => {
                        calls.push(input);
                    },
                },
            },
            ui: {
                toast: (input: unknown) => {
                    toasts.push(input);
                },
            },
        };

        await activateAccount(api, state, "openai", "work");

        expect(getActiveAccount(db, "openai")?.alias).toBe("work");
        expect(isNativeAuthCaptureSuppressed(db, "openai")).toBe(true);
        expect(calls).toEqual([{ path: { id: "openai" }, body: account.auth }]);
        expect(toasts).toEqual([{ variant: "success", message: "Activated openai/work." }]);
        expect(refreshCount()).toBe(1);
    });

    test("activateAccount applies the provider model natively when the selected provider changes", async () => {
        const { db, state } = createState();
        saveAccount(db, "github-copilot", "gh1", {
            type: "oauth",
            refresh: "refresh",
            access: "access",
            expires: Date.now() + 1000,
        });
        saveAccount(db, "openai", "work", { type: "api", key: "sk-openai-test" });
        const dispatched: string[] = [];
        const appliedProviders: string[] = [];
        const api = {
            client: {
                auth: {
                    set: async () => {},
                },
            },
            keymap: {
                dispatchCommand: (command: string) => {
                    dispatched.push(command);
                },
            },
        };

        await activateAccount(api, state, "github-copilot", "gh1", {
            sessionProviderID: "openai",
            applyNativeProviderModel: async (providerID) => {
                appliedProviders.push(providerID);
                return true;
            },
        });

        expect(dispatched).toEqual([]);
        expect(appliedProviders).toEqual(["github-copilot"]);
    });

    test("activateAccount applies the provider model natively when switching providers even if a model was selected before", async () => {
        const { db, state } = createState();
        saveAccount(db, "openai", "op1", { type: "api", key: "sk-openai-test" });
        setSelectedModel(db, "openai", "gpt-5.5");
        saveAccount(db, "github-copilot", "gh1", {
            type: "oauth",
            refresh: "refresh",
            access: "access",
            expires: Date.now() + 1000,
        });
        const appliedProviders: string[] = [];
        const api = {
            client: {
                auth: {
                    set: async () => {},
                },
            },
        };

        await activateAccount(api, state, "openai", "op1", {
            sessionProviderID: "github-copilot",
            applyNativeProviderModel: async (providerID) => {
                appliedProviders.push(providerID);
                return true;
            },
        });

        expect(appliedProviders).toEqual(["openai"]);
    });

    test("activateAccount does not apply the provider model natively when selecting the current provider again", async () => {
        const { db, state } = createState();
        saveAccount(db, "github-copilot", "gh1", {
            type: "oauth",
            refresh: "refresh",
            access: "access",
            expires: Date.now() + 1000,
        });
        const appliedProviders: string[] = [];
        const api = {
            client: {
                auth: {
                    set: async () => {},
                },
            },
        };

        await activateAccount(api, state, "github-copilot", "gh1", {
            sessionProviderID: "github-copilot",
            applyNativeProviderModel: async (providerID) => {
                appliedProviders.push(providerID);
                return true;
            },
        });

        expect(appliedProviders).toEqual([]);
    });

    test("activateAccount does not apply the provider model natively when switching accounts inside the selected provider", async () => {
        const { db, state } = createState();
        saveAccount(db, "openai", "work", { type: "api", key: "sk-openai-work" });
        saveAccount(db, "openai", "personal", { type: "api", key: "sk-openai-personal" });
        const appliedProviders: string[] = [];
        const api = {
            client: {
                auth: {
                    set: async () => {},
                },
            },
        };

        await activateAccount(api, state, "openai", "work", {
            sessionProviderID: "github-copilot",
            applyNativeProviderModel: async (providerID) => {
                appliedProviders.push(providerID);
                return true;
            },
        });

        expect(appliedProviders).toEqual([]);
    });

    test("activateAccount sends the DB-selected account auth instead of stale state auth", async () => {
        const { db, state } = createState([
            {
                providerID: "openai",
                alias: "work",
                auth: { type: "api", key: "sk-openai-stale" },
                authType: "api",
                createdAt: 1,
                updatedAt: 1,
                failures: 0,
                disabled: false,
            },
        ]);
        const account = saveAccount(db, "openai", "work", { type: "api", key: "sk-openai-current" });
        const calls: unknown[] = [];
        const api = {
            client: {
                auth: {
                    set: async (input: unknown) => {
                        calls.push(input);
                    },
                },
            },
        };

        await activateAccount(api, state, "openai", "work");

        expect(calls).toEqual([{ path: { id: "openai" }, body: account.auth }]);
    });

    test("activateAccount still refreshes when opencode auth update fails", async () => {
        const { db, state, refreshCount } = createState();
        saveAccount(db, "anthropic", "work", { type: "api", key: "sk-ant-test" });
        const api = {
            client: {
                auth: {
                    set: async () => {
                        throw new Error("opencode unavailable");
                    },
                },
            },
        };

        await expect(activateAccount(api, state, "anthropic", "work")).resolves.toBeUndefined();

        expect(getActiveAccount(db, "anthropic")?.alias).toBe("work");
        expect(refreshCount()).toBe(1);
    });

    test("removeAccountFromTui deletes an account, records an event, refreshes state, and shows success", () => {
        const { db, state, refreshCount } = createState([
            {
                providerID: "openai",
                alias: "work",
                auth: { type: "api", key: "sk-openai-test" },
                authType: "api",
                createdAt: 1,
                updatedAt: 1,
                failures: 0,
                disabled: false,
            },
        ]);
        saveAccount(db, "openai", "work", { type: "api", key: "sk-openai-test" });
        const toasts: unknown[] = [];

        removeAccountFromTui({ ui: { toast: (input: unknown) => toasts.push(input) } }, state, "openai", "work");

        expect(getActiveAccount(db, "openai")).toBeUndefined();
        expect(state.accounts()).toEqual([]);
        expect(listEvents(db, 1)[0]).toMatchObject({
            type: "account_removed",
            providerID: "openai",
            alias: "work",
            message: "Removed account openai/work.",
        });
        expect(refreshCount()).toBe(1);
        expect(toasts).toEqual([{ variant: "success", message: "Removed account openai/work." }]);
    });

    test("renameAccountFromTui renames an account, refreshes state, and shows success", () => {
        const { db, state, refreshCount } = createState();
        saveAccount(db, "openai", "a1b2c", { type: "api", key: "sk-openai-test" });
        const toasts: unknown[] = [];

        const account = renameAccountFromTui({ ui: { toast: (input: unknown) => toasts.push(input) } }, state, "openai", "a1b2c", "Work Account");

        expect(account).toMatchObject({ providerID: "openai", alias: "work-account" });
        expect(refreshCount()).toBe(1);
        expect(toasts).toEqual([{ variant: "success", message: "Renamed openai/a1b2c to work-account." }]);
    });

    test("removePendingFromTui dismisses a pending connection, refreshes state, and shows success", () => {
        const { db, state, refreshCount } = createState();
        const pending = createPendingConnection(db, "anthropic", { type: "api", key: "sk-ant-test" }, "http");
        state.refresh();
        const toasts: unknown[] = [];

        removePendingFromTui({ ui: { toast: (input: unknown) => toasts.push(input) } }, state, pending.id);

        expect(listPendingConnections(db)).toMatchObject([{ id: pending.id, promptStatus: "dismissed" }]);
        expect(state.pending()).toEqual([]);
        expect(refreshCount()).toBe(2);
        expect(toasts).toEqual([{ variant: "success", message: "Removed pending connection." }]);
    });

    test("refreshUsageForAccount persists exact usage, appends an event, refreshes state, and shows success", async () => {
        const { db, state, refreshCount } = createState();
        const account = saveAccount(db, "anthropic", "work", { type: "api", key: "sk-ant-test" });
        const toasts: unknown[] = [];
        const snapshot: ProviderUsageSnapshot = {
            providerID: "anthropic",
            alias: "work",
            fetchedAt: 123,
            confidence: "exact",
            usedTokens: 42,
            message: "Usage refreshed.",
        };

        await refreshUsageForAccount(
            { ui: { toast: (input: unknown) => toasts.push(input) } },
            state,
            "anthropic",
            "work",
            {
                refreshUsage: async (received) => {
                    expect(received).toEqual(account);
                    return snapshot;
                },
            },
        );

        expect(getUsageSnapshot(db, "anthropic", "work")).toEqual(snapshot);
        expect(listEvents(db, 1)[0]).toMatchObject({
            type: "usage_refreshed",
            providerID: "anthropic",
            alias: "work",
            message: "Usage refreshed.",
        });
        expect(refreshCount()).toBe(1);
        expect(toasts).toEqual([{ variant: "success", message: "Usage refreshed." }]);
    });

    test("refreshUsageForAccount records unavailable usage as a warning", async () => {
        const { db, state } = createState();
        saveAccount(db, "openai", "work", { type: "api", key: "sk-openai-test" });
        const toasts: unknown[] = [];
        const snapshot: ProviderUsageSnapshot = {
            providerID: "openai",
            alias: "work",
            fetchedAt: 456,
            confidence: "unavailable",
            message: "Usage unavailable.",
        };

        await refreshUsageForAccount(
            { ui: { toast: (input: unknown) => toasts.push(input) } },
            state,
            "openai",
            "work",
            { refreshUsage: async () => snapshot },
        );

        expect(getUsageSnapshot(db, "openai", "work")).toEqual(snapshot);
        expect(listEvents(db, 1)[0]).toMatchObject({
            type: "usage_unavailable",
            providerID: "openai",
            alias: "work",
            message: "Usage unavailable.",
        });
        expect(toasts).toEqual([{ variant: "warning", message: "Usage unavailable." }]);
    });

    test("refreshUsageForAccount warns without throwing when account is missing", async () => {
        const { state, refreshCount } = createState();
        const toasts: unknown[] = [];

        await expect(
            refreshUsageForAccount(
                { ui: { toast: (input: unknown) => toasts.push(input) } },
                state,
                "anthropic",
                "missing",
                {
                    refreshUsage: async () => {
                        throw new Error("should not refresh missing accounts");
                    },
                },
            ),
        ).resolves.toBeUndefined();

        expect(refreshCount()).toBe(0);
        expect(toasts).toEqual([
            { variant: "error", message: "Account not found: anthropic/missing" },
        ]);
    });
});
