/** @jsxImportSource @opentui/solid */

import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { normalizeAlias } from "../../core/accounts";
import {
	claimPendingPrompt,
	pendingPromptGroupID,
	releasePendingPrompt,
} from "../../core/pending";
import { savePendingAlias } from "../actions";
import type { BalancerTuiState } from "../state";

function errorMessage(error: unknown) {
	return error instanceof Error && error.message
		? error.message
		: "Failed to save alias";
}

const openPendingDialogs = new Set<string>();

export function openAliasDialog(
	api: TuiPluginApi,
	state: BalancerTuiState,
	pendingID: string,
) {
	const dialogID = pendingPromptGroupID(state.db, pendingID) ?? pendingID;
	if (openPendingDialogs.has(dialogID)) {
		if ("open" in api.ui.dialog && !api.ui.dialog.open)
			openPendingDialogs.delete(dialogID);
		else return false;
	}
	let claimed = claimPendingPrompt(state.db, pendingID);
	if (!claimed) {
		releasePendingPrompt(state.db, pendingID);
		claimed = claimPendingPrompt(state.db, pendingID);
	}
	if (!claimed) return false;
	const pending =
		state.pending().find((item) => item.id === pendingID) ?? claimed;
	const providerID = pending?.providerID ?? "provider";
	openPendingDialogs.add(dialogID);

	const close = () => {
		openPendingDialogs.delete(dialogID);
		api.ui.dialog.clear();
	};

	try {
		api.ui.dialog.setSize("medium");
		api.ui.dialog.replace(() => (
			<api.ui.DialogPrompt
				description={() => (
					<text fg={api.theme.current.textMuted} wrapMode="none">
						Choose an alias for {providerID}/{pending?.authType ?? "auth"}.
					</text>
				)}
				onCancel={close}
				onConfirm={async (value) => {
					const alias = normalizeAlias(value);
					if (!alias) {
						api.ui.toast({ message: "Alias is required", variant: "error" });
						return;
					}

					try {
						const account = savePendingAlias(state, pendingID, alias);
						close();
						api.ui.toast({
							message: `Saved ${account.providerID}/${account.alias}`,
							variant: "success",
						});
					} catch (error) {
						openPendingDialogs.delete(dialogID);
						api.ui.toast({ message: errorMessage(error), variant: "error" });
					}
				}}
				placeholder="account alias"
				title="Save pending connection"
			/>
		));
		return true;
	} catch {
		openPendingDialogs.delete(dialogID);
		releasePendingPrompt(state.db, pendingID);
		return false;
	}
}
