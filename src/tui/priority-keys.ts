export type PriorityKey = {
	name: string;
	shift?: boolean;
};

export type PriorityIntent =
	| { type: "move-cursor"; delta: -1 | 1 }
	| { type: "reorder"; direction: -1 | 1 }
	| { type: "toggle-enabled" }
	| { type: "open-model" }
	| { type: "toggle-balancing" }
	| { type: "back" }
	| { type: "none" };

export type PriorityFocusArea = "header" | "content";

export function movePriorityFocus(
	state: { area: PriorityFocusArea; cursor: number; rowCount: number },
	delta: -1 | 1,
): { area: PriorityFocusArea; cursor: number } {
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

export function prioritySelectionMarker(input: {
	focusedArea: PriorityFocusArea;
	itemArea: PriorityFocusArea;
	selected: boolean;
}) {
	return input.selected && input.focusedArea === input.itemArea ? "▶" : " ";
}

/**
 * Pure keybinding logic for the BIOS-style priority screen. Kept separate from
 * rendering so the whole keyboard contract is testable without a terminal.
 */
export function reducePriorityKey(key: PriorityKey): PriorityIntent {
	const name = key.name;

	if ((name === "up" || name === "down") && key.shift) {
		return { direction: name === "up" ? -1 : 1, type: "reorder" };
	}
	if (name === "up" || name === "k") return { delta: -1, type: "move-cursor" };
	if (name === "down" || name === "j") return { delta: 1, type: "move-cursor" };
	if (name === "space") return { type: "toggle-enabled" };
	if (name === "return") return { type: "open-model" };
	if (name === "b") return { type: "toggle-balancing" };
	if (name === "escape") return { type: "back" };

	return { type: "none" };
}
