import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeBalancerDatabase, openBalancerDatabase } from "../../src/core/database";
import { getActiveAccount, listAccounts } from "../../src/core/accounts";
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
        rmSync(dir, { recursive: true, force: true });
    });

    test("saves changed native auth with a generated 5 character alias after connect", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opencode-balancer-connect-"));
        const path = join(dir, "balancer.sqlite");
        const db = openBalancerDatabase(path);
        migrate(db);
        const before = { type: "oauth", refresh: "old", access: "old", expires: 1 } satisfies AuthInfo;
        const after = { type: "oauth", refresh: "new", access: "new", expires: 2 } satisfies AuthInfo;
        const toasts: unknown[] = [];
        let reads = 0;

        await openNativeConnect({
            db,
            readAuth: () => ({ ok: true, auth: { openai: reads++ === 0 ? before : after } }),
            generateAlias: () => "a1b2c",
            keymap: {
                dispatchCommand: async () => undefined,
            },
            ui: { toast: (input: unknown) => toasts.push(input) },
        });

        expect(listAccounts(db, "openai")).toMatchObject([
            { providerID: "openai", alias: "a1b2c", auth: after },
        ]);
        expect(getActiveAccount(db, "openai")?.alias).toBe("a1b2c");
        expect(isNativeConnectInProgress(db)).toBe(false);
        expect(toasts).toEqual([{ variant: "success", message: "Saved openai/a1b2c." }]);
        closeBalancerDatabase(path);
        rmSync(dir, { recursive: true, force: true });
    });

    test("waits for native auth to change after the provider dialog finishes later", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opencode-balancer-connect-"));
        const path = join(dir, "balancer.sqlite");
        const db = openBalancerDatabase(path);
        migrate(db);
        const before = { type: "oauth", refresh: "old", access: "old", expires: 1 } satisfies AuthInfo;
        const after = { type: "oauth", refresh: "new", access: "new", expires: 2 } satisfies AuthInfo;
        let reads = 0;

        await openNativeConnect({
            db,
            readAuth: () => ({ ok: true, auth: { openai: reads++ < 3 ? before : after } }),
            generateAlias: () => "d4e5f",
            keymap: {
                dispatchCommand: async () => undefined,
            },
            wait: async () => undefined,
            maxWaitMs: 100,
            pollIntervalMs: 10,
            ui: { toast: () => {} },
        });

        expect(listAccounts(db, "openai")).toMatchObject([
            { providerID: "openai", alias: "d4e5f", auth: after },
        ]);
        closeBalancerDatabase(path);
        rmSync(dir, { recursive: true, force: true });
    });

    test("clears native connect progress when no auth is saved", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opencode-balancer-connect-"));
        const path = join(dir, "balancer.sqlite");
        const db = openBalancerDatabase(path);
        migrate(db);
        const before = { type: "oauth", refresh: "old", access: "old", expires: 1 } satisfies AuthInfo;

        await openNativeConnect({
            db,
            readAuth: () => ({ ok: true, auth: { openai: before } }),
            keymap: {
                dispatchCommand: async () => undefined,
            },
            maxWaitMs: 0,
            ui: { toast: () => {} },
        });

        expect(isNativeConnectInProgress(db)).toBe(false);
        closeBalancerDatabase(path);
        rmSync(dir, { recursive: true, force: true });
    });

    test("shows an error toast when native connect is unavailable", () => {
        const toasts: unknown[] = [];

        openNativeConnect({
            keymap: {},
            ui: { toast: (input: unknown) => toasts.push(input) },
        });

        expect(toasts).toEqual([
            { variant: "error", message: "Native provider connect is unavailable in this opencode build." },
        ]);
    });
});
