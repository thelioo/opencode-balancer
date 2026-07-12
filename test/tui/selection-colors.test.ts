import { describe, expect, test } from "bun:test";
import { selectedRowColors } from "../../src/tui/selection-colors";

describe("selectedRowColors", () => {
	test("paints the selected row with the theme primary color", () => {
		const theme = {
			_hasSelectedListItemText: true,
			background: "background",
			primary: "primary",
			selectedListItemText: "selected-text",
		};

		expect(selectedRowColors(theme)).toEqual({
			bg: "primary",
			fg: "selected-text",
		});
	});

	test("falls back to the background foreground on opaque themes without selected text", () => {
		const theme = {
			_hasSelectedListItemText: false,
			background: "background",
			primary: "primary",
			selectedListItemText: "background",
		};

		expect(selectedRowColors(theme)).toEqual({
			bg: "primary",
			fg: "background",
		});
	});

	test("contrasts against a light primary on transparent-background themes", () => {
		const theme = {
			_hasSelectedListItemText: false,
			background: { a: 0, b: 0, g: 0, r: 0 },
			primary: { a: 255, b: 43, g: 91, r: 236 },
			selectedListItemText: { a: 0, b: 0, g: 0, r: 0 },
		};

		expect(selectedRowColors(theme)).toEqual({
			bg: theme.primary,
			fg: "#000000",
		});
	});

	test("contrasts against a dark primary on transparent-background themes", () => {
		const theme = {
			_hasSelectedListItemText: false,
			background: { a: 0, b: 0, g: 0, r: 0 },
			primary: { a: 255, b: 20, g: 20, r: 20 },
			selectedListItemText: { a: 0, b: 0, g: 0, r: 0 },
		};

		expect(selectedRowColors(theme)).toEqual({
			bg: theme.primary,
			fg: "#ffffff",
		});
	});
});
