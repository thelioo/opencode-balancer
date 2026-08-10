/** @jsxImportSource @opentui/solid */

import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui";
import { snapshotUsedPercent } from "../../core/usage/percent";
import type { ProviderUsageSnapshot } from "../../core/usage/types";
import { UsageBar } from "./usage-bar";

export const snapshotPercent = snapshotUsedPercent;

export function snapshotLabel(snapshot: ProviderUsageSnapshot | undefined) {
	if (!snapshot) return "usage unavailable";
	if (snapshot.confidence === "unavailable") return snapshot.message;
	const parts: string[] = [];
	if (snapshot.usedTokens !== undefined)
		parts.push(`used ${snapshot.usedTokens}`);
	if (snapshot.remainingTokens !== undefined)
		parts.push(`remaining ${snapshot.remainingTokens}`);
	if (snapshot.planName) parts.push(snapshot.planName);
	return parts.length > 0 ? parts.join(" · ") : snapshot.message;
}

export function UsageSnapshotBar(props: {
	theme: TuiThemeCurrent;
	snapshot?: ProviderUsageSnapshot;
	muted?: boolean;
}) {
	return (
		<UsageBar
			label={snapshotLabel(props.snapshot)}
			muted={props.muted}
			percent={snapshotPercent(props.snapshot)}
			theme={props.theme}
		/>
	);
}
