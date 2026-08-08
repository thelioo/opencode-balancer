/** @jsxImportSource @opentui/solid */

import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { createSignal, onCleanup } from "solid-js";
import { getActiveAccount, getSelectedAccount } from "../../core/accounts";
import {
	type ActiveSelection,
	getBalancingEnabled,
	resolveActiveSelection,
} from "../../core/priority";
import type { Account } from "../../core/types";
import { getUsageSnapshot } from "../../core/usage/store";
import { safePoll } from "../safe-poll";
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
	const [selected, setSelected] = createSignal<Account | undefined>();
	const [sessionActive, setSessionActive] = createSignal<Account | undefined>();
	const [balancing, setBalancing] = createSignal<ActiveSelection | undefined>();
	const [usage, setUsage] = createSignal<string | undefined>();
	const providerID = () =>
		typeof props.providerID === "function"
			? props.providerID()
			: props.providerID;
	const refresh = () => {
		const currentProviderID = providerID();
		const nextSelected = getSelectedAccount(props.state.db);
		const nextSessionActive = currentProviderID
			? getActiveAccount(props.state.db, currentProviderID)
			: undefined;
		const nextBalancing = getBalancingEnabled(props.state.db)
			? resolveActiveSelection(props.state.db, undefined, currentProviderID)
			: undefined;
		const usageAccount =
			nextBalancing?.account ?? nextSelected ?? nextSessionActive;
		setSelected(nextSelected);
		setSessionActive(nextSessionActive);
		setBalancing(nextBalancing);
		setUsage(
			usageAccount
				? formatUsageBar(
						snapshotPercent(
							getUsageSnapshot(
								props.state.db,
								usageAccount.providerID,
								usageAccount.alias,
							),
						),
						4,
					)
				: undefined,
		);
	};
	refresh();
	const timer = setInterval(() => safePoll(refresh), 2000);
	onCleanup(() => clearInterval(timer));

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
