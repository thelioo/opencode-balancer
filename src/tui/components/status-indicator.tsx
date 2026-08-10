/** @jsxImportSource @opentui/solid */

import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { ActiveSelection } from "../../core/priority";
import type { Account } from "../../core/types";
import type { BalancerTuiState } from "../state";
import { formatBalancerStatus } from "../status-format";
import { formatUsageBar } from "../usage-format";
import { snapshotPercent } from "./usage-display";

export type BalancerStatusIndicatorProps = {
	api: TuiPluginApi;
	state: BalancerTuiState;
	providerID?: string | (() => string | undefined);
};

export function BalancerStatusIndicator(props: BalancerStatusIndicatorProps) {
	const providerID = () =>
		typeof props.providerID === "function"
			? props.providerID()
			: props.providerID;
	// All reads below come from the worker-fed cache snapshot — no
	// bun:sqlite access happens on the main/input thread here.
	const selected = (): Account | undefined =>
		props.state.snapshot()?.selectedAccount;
	const sessionActive = (): Account | undefined => {
		const currentProviderID = providerID();
		if (!currentProviderID) return undefined;
		return props.state.snapshot()?.activeAccountByProvider[currentProviderID];
	};
	const balancing = (): ActiveSelection | undefined => {
		const snapshot = props.state.snapshot();
		if (!snapshot?.balancingEnabled) return undefined;
		const currentProviderID = providerID();
		if (currentProviderID) {
			const qualifying =
				snapshot.qualifyingSelectionByProvider[currentProviderID];
			if (qualifying) return qualifying;
		}
		return snapshot.activeSelection;
	};
	const usage = (): string | undefined => {
		const snapshot = props.state.snapshot();
		if (!snapshot) return undefined;
		const usageAccount = balancing()?.account ?? selected() ?? sessionActive();
		if (!usageAccount) return undefined;
		const key = `${usageAccount.providerID}/${usageAccount.alias}`;
		return formatUsageBar(snapshotPercent(snapshot.usageSnapshots[key]), 4);
	};

	const status = () => {
		return formatBalancerStatus({
			balancing: balancing()
				? {
						alias: balancing()!.account.alias,
						modelID: balancing()!.modelID,
						providerID: balancing()!.providerID,
					}
				: undefined,
			selected: selected(),
			sessionActive: sessionActive(),
			sessionProviderID: providerID(),
			usage: usage(),
		});
	};

	const color = () => {
		if (balancing()) return props.api.theme.current.success;
		if (providerID())
			return sessionActive()
				? props.api.theme.current.success
				: props.api.theme.current.textMuted;
		if (!selected()) return props.api.theme.current.textMuted;
		return props.api.theme.current.success;
	};

	return (
		<text fg={color()} truncate wrapMode="none">
			{status()}
		</text>
	);
}
