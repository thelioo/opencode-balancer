import { describe, expect, test } from "bun:test";
import { createSelectedAccountBarSync, type SelectedAccountBarSyncDeps } from "../../src/tui/selected-account-bar-sync";

function deps(overrides: Partial<SelectedAccountBarSyncDeps> = {}) {
    const applied: string[] = [];
    const base: SelectedAccountBarSyncDeps = {
        dialogOpen: () => false,
        selectedProvider: () => "openai",
        currentProvider: () => "opencode",
        applyProvider: async (providerID) => {
            applied.push(providerID);
            return true;
        },
        ...overrides,
    };
    return { base, applied };
}

describe("createSelectedAccountBarSync", () => {
    test("applies the selected account provider when the native provider differs", async () => {
        const { base, applied } = deps();

        const sync = createSelectedAccountBarSync(base);

        await sync.maybeSync();

        expect(applied).toEqual(["openai"]);
        expect(sync.currentProvider()).toBe("openai");
    });

    test("does not apply when the selected account already matches the native provider", async () => {
        const { base, applied } = deps({ currentProvider: () => "openai" });

        const sync = createSelectedAccountBarSync(base);

        await sync.maybeSync();

        expect(applied).toEqual([]);
    });

    test("does not apply while a dialog is open", async () => {
        const { base, applied } = deps({ dialogOpen: () => true });

        const sync = createSelectedAccountBarSync(base);

        await sync.maybeSync();

        expect(applied).toEqual([]);
    });

    test("does not repeat the same successful provider application", async () => {
        const { base, applied } = deps();

        const sync = createSelectedAccountBarSync(base);

        await sync.maybeSync();
        await sync.maybeSync();

        expect(applied).toEqual(["openai"]);
    });
});
