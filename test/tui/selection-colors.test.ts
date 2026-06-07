import { describe, expect, test } from "bun:test";
import { selectedRowColors } from "../../src/tui/selection-colors";

describe("selectedRowColors", () => {
    test("uses UI background colors instead of accent as the selected row background", () => {
        const theme = {
            text: "text",
            background: "background",
            backgroundElement: "backgroundElement",
            accent: "accent",
        };

        expect(selectedRowColors(theme)).toEqual({ fg: "text", bg: "backgroundElement" });
    });

    test("chooses the foreground with stronger contrast for RGB colors", () => {
        const theme = {
            text: { r: 245, g: 245, b: 245, a: 255 },
            textMuted: { r: 150, g: 150, b: 150, a: 255 },
            background: { r: 48, g: 0, b: 30, a: 255 },
            backgroundElement: { r: 82, g: 23, b: 55, a: 255 },
            accent: { r: 255, g: 255, b: 230, a: 255 },
        };

        expect(selectedRowColors(theme)).toEqual({ fg: theme.text, bg: theme.backgroundElement });
    });
});
