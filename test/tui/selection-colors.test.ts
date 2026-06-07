import { describe, expect, test } from "bun:test";
import { selectedRowColors } from "../../src/tui/selection-colors";

describe("selectedRowColors", () => {
	test("uses UI background colors instead of accent as the selected row background", () => {
		const theme = {
			accent: "accent",
			background: "background",
			backgroundElement: "backgroundElement",
			text: "text",
		};

		expect(selectedRowColors(theme)).toEqual({
			bg: "backgroundElement",
			fg: "text",
		});
	});

	test("chooses the foreground with stronger contrast for RGB colors", () => {
		const theme = {
			accent: { a: 255, b: 230, g: 255, r: 255 },
			background: { a: 255, b: 30, g: 0, r: 48 },
			backgroundElement: { a: 255, b: 55, g: 23, r: 82 },
			text: { a: 255, b: 245, g: 245, r: 245 },
			textMuted: { a: 255, b: 150, g: 150, r: 150 },
		};

		expect(selectedRowColors(theme)).toEqual({
			bg: theme.backgroundElement,
			fg: theme.text,
		});
	});
});
