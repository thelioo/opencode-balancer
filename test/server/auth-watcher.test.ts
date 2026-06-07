import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeBalancerDatabase, openBalancerDatabase } from "../../src/core/database";
import { getActiveAccount, getSelectedAccount, saveAccount, setActiveAccount } from "../../src/core/accounts";
import { listPendingConnections } from "../../src/core/pending";
import { migrate } from "../../src/core/schema";
import type { AuthInfo } from "../../src/core/types";
import {
    __testCreateAuthWatcher,
    __testInitialAuthSnapshot,
    __testParseNativeAuthContent,
} from "../../src/server/auth-watcher";
import { setNativeAuth } from "../../src/server/native";
import { markNativeConnectInProgress } from "../../src/core/native-connect";
import { isNativeAuthCaptureSuppressed, suppressNativeAuthCapture } from "../../src/core/native-auth-suppression";
import { createPendingConnection, removePendingConnection } from "../../src/core/pending";

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

function jwtWithChatGPTAccountID(accountID: string) {
    const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountID } }))
        .toString("base64url");
    return `header.${payload}.signature`;
}

afterEach(() => {
    for (const path of paths) closeBalancerDatabase(path);
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs = [];
    paths = [];
});

describe("auth watcher", () => {
    test("does not hide unsaved native auth in the startup snapshot", async () => {
        const database = db();
        const saved = { type: "api", key: "sk-saved" } satisfies AuthInfo;
        const unsaved = { type: "api", key: "sk-unsaved" } satisfies AuthInfo;
        saveAccount(database, "openai", "saved", saved);

        const snapshot = __testInitialAuthSnapshot(database, {
            openai: saved,
            "opencode-go": unsaved,
        });
        const watcher = __testCreateAuthWatcher({
            db: database,
            initialSnapshot: snapshot,
            readAuth: () => ({ ok: true, auth: { openai: saved, "opencode-go": unsaved } }),
            isSuppressed: () => false,
        });

        await watcher.poll();

        expect(listPendingConnections(database)).toMatchObject([
            { providerID: "opencode-go", auth: unsaved, promptStatus: "new" },
        ]);
    });

    test("does not duplicate pending rows while a poll is in flight", async () => {
        const database = db();
        const auth = { type: "api", key: "sk-main" } satisfies AuthInfo;
        let readCalls = 0;
        let resolveToast: () => void = () => {};
        const toast = new Promise<void>((resolve) => {
            resolveToast = resolve;
        });
        const watcher = __testCreateAuthWatcher({
            db: database,
            readAuth: () => {
                readCalls++;
                return { ok: true, auth: { openai: auth } };
            },
            showToast: async () => {
                await toast;
            },
        });

        const first = watcher.poll();
        const second = watcher.poll();
        await Promise.resolve();

        expect(readCalls).toBe(1);
        expect(listPendingConnections(database)).toHaveLength(1);
        resolveToast();
        await first;
        await second;
        expect(listPendingConnections(database)).toHaveLength(1);
    });

    test("invalid auth content does not clear the last valid snapshot", async () => {
        const database = db();
        const auth = { type: "api", key: "sk-main" } satisfies AuthInfo;
        const contents = ["{", JSON.stringify({ openai: auth })];
        const watcher = __testCreateAuthWatcher({
            db: database,
            initialSnapshot: { openai: auth },
            readAuth: () => __testParseNativeAuthContent(contents.shift() ?? "{}"),
        });

        await watcher.poll();
        await watcher.poll();

        expect(listPendingConnections(database)).toHaveLength(0);
    });

    test("invalid provider entries do not clear the last valid snapshot", async () => {
        const database = db();
        const auth = { type: "api", key: "sk-main" } satisfies AuthInfo;
        const contents = [
            JSON.stringify({ openai: { type: "api" } }),
            JSON.stringify({ openai: auth }),
        ];
        const watcher = __testCreateAuthWatcher({
            db: database,
            initialSnapshot: { openai: auth },
            readAuth: () => __testParseNativeAuthContent(contents.shift() ?? "{}"),
        });

        await watcher.poll();
        await watcher.poll();

        expect(listPendingConnections(database)).toHaveLength(0);
    });

    test("malformed metadata does not clear the last valid snapshot", async () => {
        const database = db();
        const auth = {
            type: "api",
            key: "sk-main",
            metadata: { account: "main" },
        } satisfies AuthInfo;
        const contents = [
            JSON.stringify({
                openai: {
                    type: "api",
                    key: "sk-main",
                    metadata: { account: 1 },
                },
            }),
            JSON.stringify({ openai: auth }),
        ];
        const watcher = __testCreateAuthWatcher({
            db: database,
            initialSnapshot: { openai: auth },
            readAuth: () => __testParseNativeAuthContent(contents.shift() ?? "{}"),
        });

        await watcher.poll();
        await watcher.poll();

        expect(listPendingConnections(database)).toHaveLength(0);
    });

    test("retries the same auth change when pending creation fails", async () => {
        const database = db();
        const auth = { type: "api", key: "sk-main" } satisfies AuthInfo;
        let attempts = 0;
        const watcher = __testCreateAuthWatcher({
            db: database,
            readAuth: () => ({ ok: true, auth: { openai: auth } }),
            createPending: () => {
                attempts++;
                throw new Error("insert failed");
            },
        });

        await expect(watcher.poll()).rejects.toThrow("insert failed");
        await expect(watcher.poll()).rejects.toThrow("insert failed");

        expect(attempts).toBe(2);
    });

    test("suppresses native auth written by the server", async () => {
        const database = db();
        const auth = { type: "api", key: "sk-server" } satisfies AuthInfo;
        await setNativeAuth(
            { auth: { set: async () => undefined } },
            "server-written",
            auth,
            database,
        );
        expect(isNativeAuthCaptureSuppressed(database, "server-written")).toBe(true);
        const watcher = __testCreateAuthWatcher({
            db: database,
            readAuth: () => ({ ok: true, auth: { "server-written": auth } }),
        });

        await watcher.poll();

        expect(listPendingConnections(database)).toHaveLength(0);
    });

    test("does not write or suppress native auth while provider connect is in progress", async () => {
        const database = db();
        const auth = { type: "api", key: "sk-server" } satisfies AuthInfo;
        const calls: unknown[] = [];
        markNativeConnectInProgress(database);

        await setNativeAuth(
            { auth: { set: async (input: unknown) => calls.push(input) } },
            "openai",
            auth,
            database,
        );

        expect(calls).toEqual([]);
        expect(isNativeAuthCaptureSuppressed(database, "openai")).toBe(false);
    });

    test("suppresses native auth changes marked in the shared database", async () => {
        const database = db();
        const auth = { type: "api", key: "sk-switched" } satisfies AuthInfo;
        suppressNativeAuthCapture(database, "openai");
        const watcher = __testCreateAuthWatcher({
            db: database,
            readAuth: () => ({ ok: true, auth: { openai: auth } }),
        });

        await watcher.poll();

        expect(listPendingConnections(database)).toHaveLength(0);
    });

    test("suppressed native auth does not overwrite the active account with unrelated credentials", async () => {
        const database = db();
        const original = {
            type: "oauth",
            refresh: "uff-refresh",
            access: jwtWithChatGPTAccountID("acct-uff"),
            expires: Date.now() + 60_000,
        } satisfies AuthInfo;
        const unrelated = {
            type: "oauth",
            refresh: "canhao-refresh",
            access: jwtWithChatGPTAccountID("acct-canhao"),
            expires: Date.now() + 60_000,
        } satisfies AuthInfo;
        saveAccount(database, "openai", "uff", original);
        suppressNativeAuthCapture(database, "openai");
        const watcher = __testCreateAuthWatcher({
            db: database,
            readAuth: () => ({ ok: true, auth: { openai: unrelated } }),
        });

        await watcher.poll();

        expect(listPendingConnections(database)).toHaveLength(0);
        expect(getActiveAccount(database, "openai")?.auth).toEqual(original);
    });

    test("persists suppressed oauth refreshes to the active account instead of leaving stale access", async () => {
        const database = db();
        saveAccount(database, "openai", "work", {
            type: "oauth",
            refresh: "refresh-token",
            access: "stale-access",
            expires: Date.now() - 1000,
        });
        const refreshed = {
            type: "oauth",
            refresh: "refresh-token",
            access: "fresh-access",
            expires: Date.now() + 60_000,
        } satisfies AuthInfo;
        await setNativeAuth(
            { auth: { set: async () => undefined } },
            "openai",
            refreshed,
        );
        const watcher = __testCreateAuthWatcher({
            db: database,
            readAuth: () => ({ ok: true, auth: { openai: refreshed } }),
        });

        await watcher.poll();

        expect(listPendingConnections(database)).toHaveLength(0);
        expect(getActiveAccount(database, "openai")?.auth).toEqual(refreshed);
    });

    test("does not create pending auth when another process observes a saved account activation", async () => {
        const database = db();
        const auth = {
            type: "oauth",
            refresh: "canhao-refresh",
            access: "canhao-access",
            expires: Date.now() + 60_000,
        } satisfies AuthInfo;
        saveAccount(database, "openai", "canhao", auth);
        const watcher = __testCreateAuthWatcher({
            db: database,
            readAuth: () => ({ ok: true, auth: { openai: auth } }),
            isSuppressed: () => false,
        });

        await watcher.poll();

        expect(listPendingConnections(database)).toHaveLength(0);
        expect(getActiveAccount(database, "openai")?.alias).toBe("canhao");
    });

    test("updates a saved oauth account by refresh token instead of prompting for an alias", async () => {
        const database = db();
        saveAccount(database, "openai", "canhao", {
            type: "oauth",
            refresh: "canhao-refresh",
            access: "old-access",
            expires: Date.now() - 1000,
        });
        const refreshed = {
            type: "oauth",
            refresh: "canhao-refresh",
            access: "new-access",
            expires: Date.now() + 60_000,
        } satisfies AuthInfo;
        const watcher = __testCreateAuthWatcher({
            db: database,
            readAuth: () => ({ ok: true, auth: { openai: refreshed } }),
            isSuppressed: () => false,
        });

        await watcher.poll();

        expect(listPendingConnections(database)).toHaveLength(0);
        expect(getActiveAccount(database, "openai")?.auth).toEqual(refreshed);
    });

    test("updates a saved oauth account by token account id when refresh token rotates", async () => {
        const database = db();
        saveAccount(database, "openai", "canhao", {
            type: "oauth",
            refresh: "old-refresh",
            access: jwtWithChatGPTAccountID("acct-canhao"),
            expires: Date.now() - 1000,
        });
        const refreshed = {
            type: "oauth",
            refresh: "new-refresh",
            access: jwtWithChatGPTAccountID("acct-canhao"),
            expires: Date.now() + 60_000,
        } satisfies AuthInfo;
        const watcher = __testCreateAuthWatcher({
            db: database,
            readAuth: () => ({ ok: true, auth: { openai: refreshed } }),
            isSuppressed: () => false,
        });

        await watcher.poll();

        expect(listPendingConnections(database)).toHaveLength(0);
        expect(getActiveAccount(database, "openai")?.auth).toEqual(refreshed);
    });

    test("updating a known native auth does not steal the manually selected account", async () => {
        const database = db();
        const copilotAuth = { type: "oauth", refresh: "gh-refresh", access: "gh-access", expires: Date.now() + 60_000 } satisfies AuthInfo;
        saveAccount(database, "github-copilot", "gh1", copilotAuth);
        saveAccount(database, "openai", "canhao", {
            type: "oauth",
            refresh: "openai-refresh",
            access: "openai-access",
            expires: Date.now() + 60_000,
        });
        setActiveAccount(database, "openai", "canhao");
        const watcher = __testCreateAuthWatcher({
            db: database,
            readAuth: () => ({ ok: true, auth: { "github-copilot": copilotAuth } }),
            isSuppressed: () => false,
        });

        await watcher.poll();

        expect(listPendingConnections(database)).toHaveLength(0);
        expect(getSelectedAccount(database)).toMatchObject({ providerID: "openai", alias: "canhao" });
    });
});
