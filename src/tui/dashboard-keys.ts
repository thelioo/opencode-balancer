export type DashboardKey = {
	name: string;
};

export type DashboardIntent =
	| { type: "move-cursor"; delta: -1 | 1 }
	| { type: "move-header"; delta: -1 | 1 }
	| { type: "primary" }
	| { type: "priority" }
	| { type: "connect" }
	| { type: "alias" }
	| { type: "rename" }
	| { type: "remove" }
	| { type: "confirm" }
	| { type: "cancel" }
	| { type: "back" }
	| { type: "none" };

export type DashboardFocusArea = "header" | "content";

export function moveDashboardFocus(
	state: { area: DashboardFocusArea; cursor: number; rowCount: number },
	delta: -1 | 1,
): { area: DashboardFocusArea; cursor: number } {
	if (state.area === "header") {
		return delta > 0
			? {
					area: "content",
					cursor: Math.max(0, Math.min(state.cursor, state.rowCount - 1)),
				}
			: { area: "header", cursor: state.cursor };
	}

	if (delta < 0 && state.cursor <= 0) return { area: "header", cursor: 0 };

	return {
		area: "content",
		cursor: Math.max(
			0,
			Math.min(state.cursor + delta, Math.max(0, state.rowCount - 1)),
		),
	};
}

export function dashboardSelectionMarker(input: {
	focusedArea: DashboardFocusArea;
	itemArea: DashboardFocusArea;
	selected: boolean;
}) {
	return input.selected && input.focusedArea === input.itemArea ? "▶" : " ";
}

export function reduceDashboardKey(key: DashboardKey): DashboardIntent {
	if (key.name === "up" || key.name === "k")
		return { delta: -1, type: "move-cursor" };
	if (key.name === "down" || key.name === "j")
		return { delta: 1, type: "move-cursor" };
	if (key.name === "left" || key.name === "h")
		return { delta: -1, type: "move-header" };
	if (key.name === "right" || key.name === "l")
		return { delta: 1, type: "move-header" };
	if (key.name === "return" || key.name === "space") return { type: "primary" };
	if (key.name === "p") return { type: "priority" };
	if (key.name === "c") return { type: "connect" };
	if (key.name === "a") return { type: "alias" };
	if (key.name === "r") return { type: "rename" };
	if (key.name === "d") return { type: "remove" };
	if (key.name === "y") return { type: "confirm" };
	if (key.name === "n") return { type: "cancel" };
	if (key.name === "escape") return { type: "back" };
	return { type: "none" };
}
