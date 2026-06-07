import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getActiveAccount, saveAccount } from "../../src/core/accounts";
import { closeBalancerDatabase, openBalancerDatabase } from "../../src/core/database";
import { createPendingConnection } from "../../src/core/pending";
import { migrate } from "../../src/core/schema";
import { runFallbackBalancerCommand } from "../../src/server/commands";

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
    for (const path of paths) closeBalancerDatabase(path);
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs = [];
    paths = [];
});

describe("runFallbackBalancerCommand", () => {
    test("help presents balancer as TUI-first with fallback commands", () => {
        const output = runFallbackBalancerCommand(db(), "help");

        expect(output).toContain("TUI-first");
        expect(output).toContain("list");
        expect(output).toContain("status");
        expect(output).toContain("use <provider> <alias>");
        expect(output).toContain("active <provider>");
    });

    test("list reports when no accounts are saved", () => {
        expect(runFallbackBalancerCommand(db(), "list")).toBe("No accounts saved.");
    });

    test("status reports account and pending counts", () => {
        const database = db();
        saveAccount(database, "openai", "main", { type: "api", key: "sk-main" });
        createPendingConnection(database, "anthropic", { type: "api", key: "sk-ant" }, "auth-file");

        expect(runFallbackBalancerCommand(database, "status")).toBe("accounts=1 pending=1");
    });

    test("active reports when a provider has no active account", () => {
        expect(runFallbackBalancerCommand(db(), "active openai")).toBe("No active account for provider.");
    });

    test("use switches the active account", () => {
        const database = db();
        saveAccount(database, "openai", "main", { type: "api", key: "sk-main" });
        saveAccount(database, "openai", "work", { type: "api", key: "sk-work" });

        expect(runFallbackBalancerCommand(database, "use openai main")).toBe(
            "Active account changed to openai/main",
        );
        expect(getActiveAccount(database, "openai")?.alias).toBe("main");
    });

    test("use reports missing accounts without throwing", () => {
        expect(runFallbackBalancerCommand(db(), "use openai missing")).toBe(
            "Account not found: openai/missing",
        );
    });
});
