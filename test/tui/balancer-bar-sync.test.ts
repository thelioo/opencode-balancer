import { describe, expect, test } from "bun:test";
import { createBalancerBarSync, type BalancerBarSyncDeps } from "../../src/tui/balancer-bar-sync";

function deps(overrides: Partial<BalancerBarSyncDeps> = {}) {
    const applied: { providerID: string; modelID: string; title: string }[] = [];
    const base: BalancerBarSyncDeps = {
        balancingEnabled: () => true,
        dialogOpen: () => false,
        activeSelection: () => ({ providerID: "openai", modelID: "gpt-5.5" }),
        modelTitle: (_providerID, modelID) => (modelID === "gpt-5.5" ? "GPT-5.5" : undefined),
        apply: async (model, title) => {
            applied.push({ ...model, title });
            return true;
        },
        ...overrides,
    };
    return { base, applied };
}

describe("maybeSyncBalancerBar", () => {
    test("applies the active balancing model to the native bar", async () => {
        const { base, applied } = deps();

        const sync = createBalancerBarSync(base);

        await sync.maybeSync();

        expect(applied).toEqual([{ providerID: "openai", modelID: "gpt-5.5", title: "GPT-5.5" }]);
    });

    test("does not reapply the same model twice", async () => {
        const { base, applied } = deps();

        const sync = createBalancerBarSync(base);

        await sync.maybeSync();
        await sync.maybeSync();

        expect(applied).toHaveLength(1);
    });

    test("waits while a dialog is open", async () => {
        const { base, applied } = deps({ dialogOpen: () => true });

        const sync = createBalancerBarSync(base);

        await sync.maybeSync();

        expect(applied).toEqual([]);
    });

    test("resets when balancing is disabled", async () => {
        let enabled = true;
        const { base, applied } = deps({ balancingEnabled: () => enabled });

        const sync = createBalancerBarSync(base);

        await sync.maybeSync();
        enabled = false;
        await sync.maybeSync();
        enabled = true;
        await sync.maybeSync();

        expect(applied).toHaveLength(2);
    });
});
