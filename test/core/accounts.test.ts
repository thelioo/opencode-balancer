import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeBalancerDatabase, openBalancerDatabase } from "../../src/core/database";
import { getAccount, getSelectedAccount, getSelectedModel, normalizeAlias, renameAccount, saveAccount, setActiveAccount, setSelectedModel } from "../../src/core/accounts";
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
    const dbPath = join(mkdtempSync(join(tmpdir(), "opencode-balancer-accounts-")), "balancer.sqlite");
    dbPaths.push(dbPath);
    const db = openBalancerDatabase(dbPath);
    migrate(db);
    return db;
}

describe("normalizeAlias", () => {
    test("normalizes spaces and invalid characters", () => {
        expect(normalizeAlias(" Work Account!! ")).toBe("work-account");
    });

    test("keeps dots underscores and hyphens", () => {
        expect(normalizeAlias("Team.Main_01")).toBe("team.main_01");
    });

    test("returns an empty string when no valid alias remains", () => {
        expect(normalizeAlias("!!!")).toBe("");
    });
});

describe("getSelectedAccount", () => {
    test("returns the most recently activated account across all providers", async () => {
        const db = createDb();
        saveAccount(db, "openai", "op1", { type: "api", key: "sk-openai-test" });
        await new Promise((resolve) => setTimeout(resolve, 1));
        saveAccount(db, "github-copilot", "gh1", { type: "oauth", refresh: "refresh", access: "access", expires: Date.now() + 1000 });
        await new Promise((resolve) => setTimeout(resolve, 1));
        setActiveAccount(db, "openai", "op1");

        expect(getSelectedAccount(db)).toMatchObject({ providerID: "openai", alias: "op1" });
    });

    test("returns the last activation even when two activations happen in the same millisecond", () => {
        const db = createDb();
        saveAccount(db, "github-copilot", "gh1", { type: "api", key: "gh" });
        saveAccount(db, "openai", "op1", { type: "api", key: "op" });

        db.query("UPDATE provider_state SET updated_at = 1000").run();
        setActiveAccount(db, "github-copilot", "gh1");
        setActiveAccount(db, "openai", "op1");

        expect(getSelectedAccount(db)).toMatchObject({ providerID: "openai", alias: "op1" });
    });

    test("persists the explicitly selected provider when activating an account", () => {
        const db = createDb();
        saveAccount(db, "github-copilot", "gh1", { type: "api", key: "gh" });
        saveAccount(db, "openai", "op1", { type: "api", key: "op" });

        setActiveAccount(db, "github-copilot", "gh1");
        setActiveAccount(db, "openai", "op1");

        const row = db.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'selected_provider_id'").get();
        expect(row?.value).toBe("openai");
    });
});

describe("renameAccount", () => {
    test("renames an account and preserves active selection", () => {
        const db = createDb();
        const auth = { type: "api", key: "sk-openai-test" } as const;
        saveAccount(db, "openai", "a1b2c", auth);

        const renamed = renameAccount(db, "openai", "a1b2c", "Work Account");

        expect(renamed).toMatchObject({ providerID: "openai", alias: "work-account", auth });
        expect(getAccount(db, "openai", "a1b2c")).toBeUndefined();
        expect(getSelectedAccount(db)).toMatchObject({ providerID: "openai", alias: "work-account" });
    });
});

describe("selected model", () => {
    test("stores and reads the selected model for a provider", () => {
        const db = createDb();

        setSelectedModel(db, "github-copilot", "claude-haiku-4.5");

        expect(getSelectedModel(db, "github-copilot")).toEqual({
            providerID: "github-copilot",
            modelID: "claude-haiku-4.5",
        });
    });

    test("preserves active alias metadata when selecting a model", () => {
        const db = createDb();
        saveAccount(db, "openai", "op1", { type: "api", key: "sk-openai-test" });

        setSelectedModel(db, "openai", "gpt-5.5");

        expect(getSelectedAccount(db)).toMatchObject({ providerID: "openai", alias: "op1" });
        expect(getSelectedModel(db, "openai")).toEqual({ providerID: "openai", modelID: "gpt-5.5" });
    });
});
