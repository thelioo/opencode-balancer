// Mirrors opencode's own selected-list-item styling: a selected row is painted
// with the theme's `primary` colour and a foreground picked the same way
// opencode's `selectedForeground` does. Using `backgroundElement` (as this used
// to) is invisible on themes where the element/background colours are
// transparent, so the selection highlight would not show at all.

type SelectionTheme<TColor> = {
	primary: TColor;
	background?: TColor;
	selectedListItemText?: TColor;
	_hasSelectedListItemText?: boolean;
};

export function selectedRowColors<TColor>(theme: SelectionTheme<TColor>): {
	bg: TColor;
	fg: TColor | string;
} {
	const bg = theme.primary;
	return { bg, fg: selectedForeground(theme, bg) };
}

function selectedForeground<TColor>(
	theme: SelectionTheme<TColor>,
	bg: TColor,
): TColor | string {
	// Themes that explicitly define the selected text colour win.
	if (
		theme._hasSelectedListItemText &&
		theme.selectedListItemText !== undefined
	) {
		return theme.selectedListItemText;
	}
	// On transparent-background themes there is no usable background colour to
	// read the foreground from, so contrast against the selection background.
	if (alpha(theme.background) === 0) {
		const target = channels(bg);
		if (target) {
			const relative =
				(0.299 * target.r + 0.587 * target.g + 0.114 * target.b) / 255;
			return relative > 0.5 ? "#000000" : "#ffffff";
		}
	}
	return theme.background ?? bg;
}

function alpha(value: unknown) {
	if (!value || typeof value !== "object") return undefined;
	const color = value as {
		a?: unknown;
		alpha?: unknown;
		buffer?: ArrayLike<number>;
	};
	if (color.buffer && typeof color.buffer[3] === "number") {
		return color.buffer[3];
	}
	const a = color.a ?? color.alpha;
	return typeof a === "number" ? a : undefined;
}

function channels(value: unknown) {
	if (!value || typeof value !== "object") return undefined;
	const color = value as Record<string, unknown>;
	const r = numberChannel(color.r ?? color.red);
	const g = numberChannel(color.g ?? color.green);
	const b = numberChannel(color.b ?? color.blue);
	return r === undefined || g === undefined || b === undefined
		? undefined
		: { b, g, r };
}

function numberChannel(value: unknown) {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(0, Math.min(255, value))
		: undefined;
}
