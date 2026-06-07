import { describe, expect, test } from "bun:test";
import { dashboardContentHeight, dashboardLayoutMode } from "../../src/tui/responsive";

describe("dashboard responsive layout", () => {
    test("uses compact mode for narrow terminals", () => {
        expect(dashboardLayoutMode({ width: 82, height: 28 })).toBe("compact");
        expect(dashboardLayoutMode({ width: 120, height: 28 })).toBe("full");
    });

    test("uses compact mode for short terminals", () => {
        expect(dashboardLayoutMode({ width: 140, height: 22 })).toBe("compact");
    });

    test("keeps a fixed scrollable content height under header and footer", () => {
        expect(dashboardContentHeight({ height: 28 })).toBe(20);
        expect(dashboardContentHeight({ height: 12 })).toBe(6);
    });
});
