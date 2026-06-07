/** @jsxImportSource @opentui/solid */

import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { normalizeAlias } from "../../core/accounts";
import { renameAccountFromTui } from "../actions";
import type { BalancerTuiState } from "../state";

function errorMessage(error: unknown) {
    return error instanceof Error && error.message ? error.message : "Failed to rename account";
}

export function openRenameDialog(api: TuiPluginApi, state: BalancerTuiState, providerID: string, alias: string) {
    api.ui.dialog.setSize("medium");
    api.ui.dialog.replace(() => (
        <api.ui.DialogPrompt
            title="Rename account"
            placeholder="account alias"
            description={() => (
                <text fg={api.theme.current.textMuted} wrapMode="none">
                    Choose a new alias for {providerID}/{alias}.
                </text>
            )}
            onCancel={() => api.ui.dialog.clear()}
            onConfirm={(value) => {
                const nextAlias = normalizeAlias(value);
                if (!nextAlias) {
                    api.ui.toast({ variant: "error", message: "Alias is required" });
                    return;
                }

                try {
                    renameAccountFromTui(api, state, providerID, alias, nextAlias);
                    api.ui.dialog.clear();
                } catch (error) {
                    api.ui.toast({ variant: "error", message: errorMessage(error) });
                }
            }}
        />
    ));
}
