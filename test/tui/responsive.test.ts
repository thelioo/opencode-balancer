import { describe, expect, test } from "bun:test";
import {
	dashboardContentHeight,
	dashboardLayoutMode,
} from "../../src/tui/responsive";

describe("dashboard responsive layout", () => {
	test("uses compact mode for narrow terminals", () => {
		expect(dashboardLayoutMode({ height: 28, width: 82 })).toBe("compact");
		expect(dashboardLayoutMode({ height: 28, width: 120 })).toBe("full");
	});

	test("uses compact mode for short terminals", () => {
		expect(dashboardLayoutMode({ height: 22, width: 140 })).toBe("compact");
	});

	test("keeps a fixed scrollable content height under header and footer", () => {
		expect(dashboardContentHeight({ height: 28 })).toBe(20);
		expect(dashboardContentHeight({ height: 12 })).toBe(6);
	});
});
