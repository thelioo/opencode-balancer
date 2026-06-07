/** @jsxImportSource @opentui/solid */

import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { setSelectedModel } from "../../core/accounts";
import {
	createNativeModelApplier,
	type NativeModelApplier,
} from "../native-model-apply";
import {
	type ProviderModelOption,
	providerModelOptions,
} from "../provider-models";
import type { BalancerTuiState } from "../state";

type OpenProviderModelDialogOptions = {
	// Test seam: replays the chosen model into opencode's native dialog so the
	// native model bar updates. Defaults to driving opencode via simulated keys.
	applyNativeSelection?: NativeModelApplier | false;
	onComplete?: () => void;
	onSelected?: (model: { providerID: string; modelID: string }) => void;
};

export function openProviderModelDialog(
	api: TuiPluginApi,
	state: Pick<BalancerTuiState, "db" | "refresh">,
	providerID: string,
	options: OpenProviderModelDialogOptions = {},
) {
	const modelOptions = providerModelOptions(api.state.provider, providerID);
	const providerName = modelOptions[0]?.providerName ?? providerID;
	const applyNativeSelection =
		options.applyNativeSelection ?? createNativeModelApplier(api);

	api.ui.dialog.setSize("medium");
	api.ui.dialog.replace(() => (
		<api.ui.DialogSelect<ProviderModelOption>
			flat
			onSelect={(option) => {
				const model = {
					modelID: option.value.modelID,
					providerID: option.value.providerID,
				};

				// Persist first: in manual mode this stores the selected model;
				// priority mode injects its own persistence callback.
				if (options.onSelected) options.onSelected(model);
				else setSelectedModel(state.db, model.providerID, model.modelID);
				state.refresh();

				// Close our picker, then replay the choice into opencode's native
				// model dialog so its bottom model bar reflects the selection.
				api.ui.dialog.clear();

				if (applyNativeSelection === false) {
					options.onComplete?.();
					return;
				}

				void Promise.resolve(applyNativeSelection(model, option.value.title))
					.then((applied) => {
						if (applied) {
							api.ui.toast({
								message: `Switched to ${option.value.providerName}/${option.value.title}.`,
								variant: "success",
							});
							return;
						}
						api.ui.toast({
							message: `Selected ${option.value.providerName}/${option.value.title}; prompts will use it, but opencode's model bar may not have refreshed.`,
							variant: "warning",
						});
					})
					.finally(() => {
						options.onComplete?.();
					});
			}}
			options={modelOptions.map((option) => ({
				description: option.providerName,
				footer: `${option.providerID}/${option.modelID}`,
				title: option.title,
				value: option,
			}))}
			placeholder={`Search ${providerName} models`}
			skipFilter={false}
			title={`Select ${providerName} model`}
		/>
	));
}
