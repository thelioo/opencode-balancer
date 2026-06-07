/** @jsxImportSource @opentui/solid */

import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui";
import { formatUsageBar, truncateMiddle } from "../usage-format";

export function UsageBar(props: {
	theme: TuiThemeCurrent;
	percent?: number;
	label: string;
	muted?: boolean;
}) {
	const color = () =>
		props.muted || props.percent === undefined
			? props.theme.textMuted
			: props.theme.primary;
	return (
		<text fg={color()} overflow="hidden" truncate wrapMode="none">
			{formatUsageBar(props.percent, 8)}{" "}
			<span style={{ fg: props.theme.textMuted }}>
				{truncateMiddle(props.label, 34)}
			</span>
		</text>
	);
}
