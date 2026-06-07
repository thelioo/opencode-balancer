import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveAccount } from "../../src/core/accounts";
import { closeBalancerDatabase, openBalancerDatabase } from "../../src/core/database";
import { migrate } from "../../src/core/schema";
import { getUsageSnapshot } from "../../src/core/usage/store";
import { createUsageAutoRefresh } from "../../src/tui/usage-auto-refresh";
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

function createState() {
    const dbPath = join(mkdtempSync(join(tmpdir(), "opencode-balancer-auto-refresh-")), "balancer.sqlite");
    dbPaths.push(dbPath);
    const db = openBalancerDatabase(dbPath);
    migrate(db);
    let refreshes = 0;

    return {
        db,
        state: {
            db,
            version: () => 0,
            refresh: () => {
                refreshes += 1;
            },
            accounts: () => [],
            pending: () => [],
            events: () => [],
            removeAccountView: () => {},
            removePendingView: () => {},
            dispose: () => closeBalancerDatabase(dbPath),
        } satisfies BalancerTuiState,
        refreshCount: () => refreshes,
    };
}

describe("usage auto refresh", () => {
    test("refreshes every account without showing toasts", async () => {
        const { db, state, refreshCount } = createState();
        saveAccount(db, "openai", "work", { type: "api", key: "sk-openai" });
        saveAccount(db, "github-copilot", "personal", { type: "oauth", refresh: "r", access: "a", expires: 1 });
        const toasts: unknown[] = [];
        const refreshed: string[] = [];

        const autoRefresh = createUsageAutoRefresh(
            { ui: { toast: (input: unknown) => toasts.push(input) } },
            state,
            {
                intervalMs: 0,
                refreshUsage: async (account) => {
                    refreshed.push(`${account.providerID}/${account.alias}`);
                    return {
                        providerID: account.providerID,
                        alias: account.alias,
                        fetchedAt: 123,
                        confidence: "exact",
                        usedPercent: 10,
                        message: `usage ${account.providerID}/${account.alias}`,
                    };
                },
            },
        );

        await autoRefresh.refreshNow();

        expect(refreshed.toSorted()).toEqual(["github-copilot/personal", "openai/work"]);
        expect(getUsageSnapshot(db, "openai", "work")?.message).toBe("usage openai/work");
        expect(getUsageSnapshot(db, "github-copilot", "personal")?.message).toBe("usage github-copilot/personal");
        expect(refreshCount()).toBe(2);
        expect(toasts).toEqual([]);
        autoRefresh.dispose();
    });

    test("refreshes on prompt activity with debounce", async () => {
        const { db, state } = createState();
        saveAccount(db, "openai", "work", { type: "api", key: "sk-openai" });
        let now = 1_000;
        let calls = 0;
        const autoRefresh = createUsageAutoRefresh(
            { ui: { toast: () => {} } },
            state,
            {
                intervalMs: 0,
                promptDebounceMs: 10_000,
                now: () => now,
                refreshUsage: async (account) => {
                    calls += 1;
                    return {
                        providerID: account.providerID,
                        alias: account.alias,
                        fetchedAt: now,
                        confidence: "exact",
                        message: "usage refreshed",
                    };
                },
            },
        );

        await autoRefresh.refreshForPrompt();
        await autoRefresh.refreshForPrompt();
        now += 10_000;
        await autoRefresh.refreshForPrompt();

        expect(calls).toBe(2);
        autoRefresh.dispose();
    });
});
