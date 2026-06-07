import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeBalancerDatabase, openBalancerDatabase } from "../../src/core/database";
import { migrate } from "../../src/core/schema";

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

function createDb() {
    const dbPath = join(mkdtempSync(join(tmpdir(), "opencode-balancer-dialog-")), "balancer.sqlite");
    dbPaths.push(dbPath);
    const db = openBalancerDatabase(dbPath);
    migrate(db);
    return db;
}

describe("openAliasDialog", () => {
    test("opens a previously prompted pending connection so the alias can be recovered", async () => {
        await import("@opentui/solid/runtime-plugin" + "-support");
        const { claimPendingPrompt, createPendingConnection } = await import("../../src/core/pending");
        const { openAliasDialog } = await import("../../src/tui/components/alias-dialog" + ".tsx");
        const database = createDb();
        const pending = createPendingConnection(database, "openai", { type: "api", key: "k" }, "auth-file");
        claimPendingPrompt(database, pending.id);
        let replaces = 0;
        let promptProps: { onCancel?: () => unknown } | undefined;
        const api = {
            theme: { current: { textMuted: "muted" } },
            ui: {
                DialogPrompt: (props: { onCancel?: () => unknown }) => {
                    promptProps = props;
                    return null;
                },
                dialog: {
                    setSize: () => {},
                    replace: (render: () => unknown) => {
                        replaces++;
                        return render();
                    },
                    clear: () => {},
                },
                toast: () => {},
            },
        };
        const state = {
            pending: () => [{ id: pending.id, providerID: "openai", authType: "api", promptStatus: "prompted" }],
            db: database,
            refresh: () => {},
        };

        expect(openAliasDialog(api as never, state as never, pending.id)).toBe(true);
        promptProps?.onCancel?.();

        expect(replaces).toBe(1);
    });

    test("keeps a pending connection actionable when opening the dialog fails", async () => {
        await import("@opentui/solid/runtime-plugin" + "-support");
        const { createPendingConnection, listPendingConnections } = await import("../../src/core/pending");
        const { openAliasDialog } = await import("../../src/tui/components/alias-dialog" + ".tsx");
        const database = createDb();
        const pending = createPendingConnection(database, "openai", { type: "api", key: "k" }, "auth-file");
        const api = {
            theme: { current: { textMuted: "muted" } },
            ui: {
                DialogPrompt: () => null,
                dialog: {
                    setSize: () => {},
                    replace: () => {
                        throw new Error("dialog unavailable");
                    },
                    clear: () => {},
                },
                toast: () => {},
            },
        };
        const state = {
            pending: () => [{ id: pending.id, providerID: "openai", authType: "api" }],
            db: database,
            refresh: () => {},
        };

        expect(openAliasDialog(api as never, state as never, pending.id)).toBe(false);

        expect(listPendingConnections(database).map((item) => item.promptStatus)).toEqual(["new"]);
    });

    test("does not open duplicate alias dialogs for the same pending connection", async () => {
        await import("@opentui/solid/runtime-plugin" + "-support");
        const { createPendingConnection } = await import("../../src/core/pending");
        const { openAliasDialog } = await import("../../src/tui/components/alias-dialog" + ".tsx");
        const database = createDb();
        const pending = createPendingConnection(database, "openai", { type: "api", key: "k" }, "auth-file");
        let replaces = 0;
        let promptProps: { onCancel?: () => unknown } | undefined;
        const api = {
            theme: { current: { textMuted: "muted" } },
            ui: {
                DialogPrompt: (props: { onCancel?: () => unknown }) => {
                    promptProps = props;
                    return null;
                },
                dialog: {
                    setSize: () => {},
                    replace: (render: () => unknown) => {
                        replaces++;
                        return render();
                    },
                    clear: () => {},
                },
                toast: () => {},
            },
        };
        const state = {
            pending: () => [{ id: pending.id, providerID: "openai", authType: "api" }],
            db: database,
            refresh: () => {},
        };

        openAliasDialog(api as never, state as never, pending.id);
        openAliasDialog(api as never, state as never, pending.id);
        promptProps?.onCancel?.();

        expect(replaces).toBe(1);
    });

    test("reopens a pending alias dialog after the TUI dialog was externally cleared", async () => {
        await import("@opentui/solid/runtime-plugin" + "-support");
        const { createPendingConnection } = await import("../../src/core/pending");
        const { openAliasDialog } = await import("../../src/tui/components/alias-dialog" + ".tsx");
        const database = createDb();
        const pending = createPendingConnection(database, "openai", { type: "api", key: "stale" }, "auth-file");
        let dialogOpen = false;
        let replaces = 0;
        const api = {
            theme: { current: { textMuted: "muted" } },
            ui: {
                DialogPrompt: () => null,
                dialog: {
                    get open() {
                        return dialogOpen;
                    },
                    setSize: () => {},
                    replace: (render: () => unknown) => {
                        dialogOpen = true;
                        replaces++;
                        return render();
                    },
                    clear: () => {
                        dialogOpen = false;
                    },
                },
                toast: () => {},
            },
        };
        const state = {
            pending: () => [{ id: pending.id, providerID: "openai", authType: "api", promptStatus: "new" }],
            db: database,
            refresh: () => {},
        };

        expect(openAliasDialog(api as never, state as never, pending.id)).toBe(true);
        dialogOpen = false;
        expect(openAliasDialog(api as never, state as never, pending.id)).toBe(true);

        expect(replaces).toBe(2);
    });

    test("does not open duplicate alias dialogs for equivalent pending connections", async () => {
        await import("@opentui/solid/runtime-plugin" + "-support");
        const { createPendingConnection } = await import("../../src/core/pending");
        const { openAliasDialog } = await import("../../src/tui/components/alias-dialog" + ".tsx");
        const database = createDb();
        const auth = { type: "oauth" as const, refresh: "r", access: "a", expires: 123 };
        const first = createPendingConnection(database, "openai", auth, "auth-file");
        database
            .query(
                `INSERT INTO pending_connections (
                     id, provider_id, auth_json, auth_type, source, captured_at, prompt_status
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run("legacy-duplicate", "openai", JSON.stringify(auth), "oauth", "auth-file", Date.now(), "new");
        let replaces = 0;
        const api = {
            theme: { current: { textMuted: "muted" } },
            ui: {
                DialogPrompt: () => null,
                dialog: {
                    setSize: () => {},
                    replace: (render: () => unknown) => {
                        replaces++;
                        return render();
                    },
                    clear: () => {},
                },
                toast: () => {},
            },
        };
        const state = {
            pending: () => [
                { id: first.id, providerID: "openai", authType: "oauth" },
                { id: "legacy-duplicate", providerID: "openai", authType: "oauth" },
            ],
            db: database,
            refresh: () => {},
        };

        openAliasDialog(api as never, state as never, first.id);
        openAliasDialog(api as never, state as never, "legacy-duplicate");

        expect(replaces).toBe(1);
    });

    test("does not open a dialog for a missing pending connection", async () => {
        await import("@opentui/solid/runtime-plugin" + "-support");
        const { openAliasDialog } = await import("../../src/tui/components/alias-dialog" + ".tsx");
        let replaces = 0;
        const api = {
            theme: { current: { textMuted: "muted" } },
            ui: {
                DialogPrompt: () => null,
                dialog: {
                    setSize: () => {},
                    replace: (render: () => unknown) => {
                        replaces++;
                        return render();
                    },
                    clear: () => {},
                },
                toast: () => {},
            },
        };
        const state = {
            pending: () => [{ id: "pending-1", providerID: "openai", authType: "api" }],
            db: createDb(),
            refresh: () => {},
        };

        openAliasDialog(api as never, state as never, "missing-pending");

        expect(replaces).toBe(0);
    });
});
