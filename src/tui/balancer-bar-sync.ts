import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { getBalancingEnabled, resolveActiveSelection } from "../core/priority";
import {
	createNativeModelApplier,
	type NativeModelApplier,
} from "./native-model-apply";
import type { BalancerTuiState } from "./state";

export type BalancerBarSyncDeps = {
	balancingEnabled: () => boolean;
	dialogOpen: () => boolean;
	activeSelection: () => { providerID: string; modelID: string } | undefined;
	modelTitle: (providerID: string, modelID: string) => string | undefined;
	apply: NativeModelApplier;
};

export function createBalancerBarSync(deps: BalancerBarSyncDeps) {
	let lastApplied: string | undefined;
	let applying = false;

	const maybeSync = async () => {
		if (!deps.balancingEnabled()) {
			lastApplied = undefined;
			return false;
		}
		if (applying || deps.dialogOpen()) return false;

		const selection = deps.activeSelection();
		if (!selection) return false;

		const key = `${selection.providerID}/${selection.modelID}`;
		if (key === lastApplied) return false;

		const title =
			deps.modelTitle(selection.providerID, selection.modelID) ??
			selection.modelID;
		applying = true;
		try {
			const applied = await deps.apply(selection, title);
			if (applied) lastApplied = key;
			return applied;
		} finally {
			applying = false;
		}
	};

	return { maybeSync };
}

export function createTuiBalancerBarSync(
	api: TuiPluginApi,
	state: BalancerTuiState,
) {
	return createBalancerBarSync({
		activeSelection: () => resolveActiveSelection(state.db),
		apply: createNativeModelApplier(api),
		balancingEnabled: () => getBalancingEnabled(state.db),
		dialogOpen: () => api.ui.dialog.open,
		modelTitle: (providerID, modelID) => {
			const provider = api.state.provider.find(
				(item) => item.id === providerID,
			);
			return provider?.models?.[modelID]?.name;
		},
	});
}
