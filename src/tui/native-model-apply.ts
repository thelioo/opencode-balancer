import type { TuiPluginApi } from "@opencode-ai/plugin/tui";

const ENTER = "\r";
const ESCAPE = "\x1B";

type StdinLike = { emit: (event: string, data: unknown) => unknown };

function rendererStdin(api: TuiPluginApi): StdinLike | undefined {
    const stdin = (api.renderer as unknown as { stdin?: StdinLike } | undefined)?.stdin;
    return stdin && typeof stdin.emit === "function" ? stdin : undefined;
}

/**
 * Feed a raw input sequence into opencode's renderer, exactly like a real
 * keypress. opencode's stdin parser dispatches it to the focused element, so
 * this drives opencode's own UI even though the plugin runs in a separate
 * Solid instance and cannot touch opencode's reactive state directly.
 */
function feed(api: TuiPluginApi, sequence: string): boolean {
    const stdin = rendererStdin(api);
    if (!stdin) return false;
    stdin.emit("data", Buffer.from(sequence));
    return true;
}

export type NativeModelApplier = (model: { providerID: string; modelID: string }, title: string) => Promise<boolean>;

export type NativeModelApplyDeps = {
    dispatchCommand: (command: string) => void;
    isDialogOpen: () => boolean;
    feed: (sequence: string) => boolean;
    wait: (ms: number) => Promise<void>;
    settleMs?: number;
};

/**
 * Drive opencode's native model dialog to select `title`:
 *   1. open it via the native `model.list` command
 *   2. type the model title to filter the list down to the target
 *   3. press Enter to select -> opencode runs `local.model.set` and the bar updates
 *   4. dismiss a follow-up variant dialog if one appears
 */
export async function applyNativeModelSelection(deps: NativeModelApplyDeps, title: string): Promise<boolean> {
    const settle = deps.settleMs ?? 90;

    deps.dispatchCommand("model.list");
    await deps.wait(settle);
    if (!deps.isDialogOpen()) return false;

    if (!deps.feed(title)) return false;
    await deps.wait(settle);

    if (!deps.feed(ENTER)) return false;
    await deps.wait(settle);

    // A model with variants opens a follow-up dialog; close it so the bar keeps
    // the model we just set (with its default variant).
    if (deps.isDialogOpen()) deps.feed(ESCAPE);
    return true;
}

export function createNativeModelApplier(api: TuiPluginApi): NativeModelApplier {
    return (_model, title) =>
        applyNativeModelSelection(
            {
                dispatchCommand: (command) => api.keymap.dispatchCommand(command),
                isDialogOpen: () => api.ui.dialog.open,
                feed: (sequence) => feed(api, sequence),
                wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            },
            title,
        );
}
