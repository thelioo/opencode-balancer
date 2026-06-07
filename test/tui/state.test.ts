import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoot } from "solid-js";
import { saveAccount } from "../../src/core/accounts";
import { closeBalancerDatabase, openBalancerDatabase } from "../../src/core/database";
import { appendEvent } from "../../src/core/events";
import { createPendingConnection } from "../../src/core/pending";
import { createBalancerTuiState } from "../../src/tui/state";

let configDirs: string[] = [];

afterEach(() => {
    for (const dir of configDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
    configDirs = [];
    delete Bun.env.OPENCODE_CONFIG_DIR;
});

function withTempConfigDir() {
    const dir = mkdtempSync(join(tmpdir(), "opencode-balancer-tui-"));
    configDirs.push(dir);
    Bun.env.OPENCODE_CONFIG_DIR = dir;
    return join(dir, "balancer.sqlite");
}

describe("createBalancerTuiState", () => {
    test("refreshes accounts, pending connections, and recent events from sqlite", () => {
        withTempConfigDir();

        createRoot((dispose) => {
            const state = createBalancerTuiState();
            try {
                expect(state.accounts()).toEqual([]);
                expect(state.pending()).toEqual([]);
                expect(state.events()).toEqual([]);

                saveAccount(state.db, "anthropic", "work", { type: "api", key: "sk-ant-test" });
                createPendingConnection(state.db, "openai", { type: "api", key: "sk-openai-test" }, "http");
                appendEvent(state.db, {
                    type: "account.saved",
                    providerID: "anthropic",
                    alias: "work",
                    message: "saved work account",
                });

                state.refresh();

                expect(state.accounts().map((account) => `${account.providerID}/${account.alias}`)).toEqual([
                    "anthropic/work",
                ]);
                expect(state.pending().map((pending) => `${pending.providerID}/${pending.authType}`)).toEqual([
                    "openai/api",
                ]);
                expect(state.events().map((event) => event.message)).toEqual(["saved work account"]);
                expect(state.version()).toBe(2);
            } finally {
                state.dispose();
                dispose();
            }
        });
    });

    test("dispose closes the cached sqlite handle", () => {
        const dbPath = withTempConfigDir();

        createRoot((dispose) => {
            const state = createBalancerTuiState();
            try {
                expect(openBalancerDatabase(dbPath)).toBe(state.db);

                state.dispose();

                const reopened = openBalancerDatabase(dbPath);
                try {
                    expect(reopened).not.toBe(state.db);
                    expect(() => reopened.exec("SELECT 1;")).not.toThrow();
                } finally {
                    closeBalancerDatabase(dbPath);
                }
            } finally {
                state.dispose();
                dispose();
            }
        });
    });
});
