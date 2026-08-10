/** @jsxImportSource @opentui/solid */

import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { For, Show } from "solid-js";
import type { Account } from "../../core/types";
import type { ProviderUsageSnapshot } from "../../core/usage/types";
import type { BalancerTuiState } from "../state";
import { UsageSnapshotBar } from "./usage-display";

export type BalancerSidebarProps = {
	api: TuiPluginApi;
	state: BalancerTuiState;
	openDashboard: () => void;
	activateAccount: (providerID: string, alias: string) => void;
};

export function BalancerSidebar(props: BalancerSidebarProps) {
	const theme = () => props.api.theme.current;
	// Reads come from the worker-fed cache snapshot — no bun:sqlite access
	// happens on the main/input thread here.
	const accounts = (): Account[] => props.state.snapshot()?.accounts ?? [];
	const balancingEnabled = (): boolean =>
		props.state.snapshot()?.balancingEnabled ?? false;
	const usage = (): Record<string, ProviderUsageSnapshot | undefined> =>
		props.state.snapshot()?.usageSnapshots ?? {};
	const Button = (buttonProps: { label: string; onClick: () => void }) => (
		<box onMouseUp={buttonProps.onClick} paddingLeft={0} paddingRight={0}>
			<text fg={theme().accent} truncate wrapMode="none">
				[ {buttonProps.label} ]
			</text>
		</box>
	);

	return (
		<box flexDirection="column" gap={1}>
			<box flexDirection="column" gap={0}>
				<text fg={theme().text} wrapMode="none">
					Balancer
				</text>
				<text
					fg={balancingEnabled() ? theme().success : theme().textMuted}
					wrapMode="none"
				>
					{balancingEnabled() ? "ON" : "OFF"}
				</text>
				<Button label="dashboard" onClick={() => props.openDashboard()} />
				<text fg={theme().textMuted} wrapMode="none">
					ctrl+b
				</text>
			</box>

			<box flexDirection="column" gap={0}>
				<text fg={theme().textMuted} wrapMode="none">
					Accounts
				</text>
				<Show
					fallback={
						<text fg={theme().textMuted} wrapMode="none">
							none
						</text>
					}
					when={accounts().length > 0}
				>
					<For each={accounts()}>
						{(account) => (
							<box
								flexDirection="column"
								gap={0}
								onMouseUp={() =>
									props.activateAccount(account.providerID, account.alias)
								}
							>
								<text fg={theme().text} truncate wrapMode="none">
									<span style={{ fg: theme().primary }}>
										{account.providerID}
									</span>
									/
									<span
										style={{
											fg: account.disabled ? theme().textMuted : theme().text,
										}}
									>
										{account.alias}
									</span>{" "}
									<span style={{ fg: theme().textMuted }}>
										({account.authType})
									</span>
								</text>
								<UsageSnapshotBar
									snapshot={usage()[`${account.providerID}/${account.alias}`]}
									theme={theme()}
								/>
							</box>
						)}
					</For>
				</Show>
			</box>
		</box>
	);
}
