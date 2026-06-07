import { describe, expect, test } from "bun:test";
import { applyNativeModelSelection, type NativeModelApplyDeps } from "../../src/tui/native-model-apply";

function deps(overrides: Partial<NativeModelApplyDeps> = {}) {
    const events: string[] = [];
    const fed: string[] = [];
    const base: NativeModelApplyDeps = {
        dispatchCommand: (command) => events.push(`dispatch:${command}`),
        isDialogOpen: () => true,
        feed: (sequence) => {
            fed.push(sequence);
            return true;
        },
        wait: async () => {},
        settleMs: 0,
        ...overrides,
    };
    return { base, events, fed };
}

describe("applyNativeModelSelection", () => {
    test("opens model.list, types the title, and presses Enter", async () => {
        const { base, events, fed } = deps({ isDialogOpen: () => true });
        // dialog stays open only until selection; after Enter assume it closed
        let openCalls = 0;
        base.isDialogOpen = () => {
            openCalls += 1;
            // open after dispatch (call 1), closed after Enter (call 2)
            return openCalls === 1;
        };

        const ok = await applyNativeModelSelection(base, "Claude Haiku 4.5");

        expect(ok).toBe(true);
        expect(events).toEqual(["dispatch:model.list"]);
        expect(fed).toEqual(["Claude Haiku 4.5", "\r"]);
    });

    test("dismisses a follow-up variant dialog with Escape", async () => {
        const { base, fed } = deps({ isDialogOpen: () => true });

        const ok = await applyNativeModelSelection(base, "Gemini 2.5 Pro");

        expect(ok).toBe(true);
        expect(fed).toEqual(["Gemini 2.5 Pro", "\r", "\x1B"]);
    });

    test("bails out if the native model dialog never opens", async () => {
        const { base, events, fed } = deps({ isDialogOpen: () => false });

        const ok = await applyNativeModelSelection(base, "GPT-5.5");

        expect(ok).toBe(false);
        expect(events).toEqual(["dispatch:model.list"]);
        expect(fed).toEqual([]);
    });
});
