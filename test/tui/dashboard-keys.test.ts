import { describe, expect, test } from "bun:test";
import { dashboardSelectionMarker, moveDashboardFocus, reduceDashboardKey } from "../../src/tui/dashboard-keys";

describe("reduceDashboardKey", () => {
    test("arrow and vim keys move the cursor", () => {
        expect(reduceDashboardKey({ name: "up" })).toEqual({ type: "move-cursor", delta: -1 });
        expect(reduceDashboardKey({ name: "down" })).toEqual({ type: "move-cursor", delta: 1 });
        expect(reduceDashboardKey({ name: "k" })).toEqual({ type: "move-cursor", delta: -1 });
        expect(reduceDashboardKey({ name: "j" })).toEqual({ type: "move-cursor", delta: 1 });
    });

    test("left and right arrows move across header actions", () => {
        expect(reduceDashboardKey({ name: "left" })).toEqual({ type: "move-header", delta: -1 });
        expect(reduceDashboardKey({ name: "right" })).toEqual({ type: "move-header", delta: 1 });
        expect(reduceDashboardKey({ name: "h" })).toEqual({ type: "move-header", delta: -1 });
        expect(reduceDashboardKey({ name: "l" })).toEqual({ type: "move-header", delta: 1 });
    });

    test("maps dashboard actions", () => {
        expect(reduceDashboardKey({ name: "return" })).toEqual({ type: "primary" });
        expect(reduceDashboardKey({ name: "space" })).toEqual({ type: "primary" });
        expect(reduceDashboardKey({ name: "p" })).toEqual({ type: "priority" });
        expect(reduceDashboardKey({ name: "c" })).toEqual({ type: "connect" });
        expect(reduceDashboardKey({ name: "a" })).toEqual({ type: "alias" });
        expect(reduceDashboardKey({ name: "r" })).toEqual({ type: "rename" });
        expect(reduceDashboardKey({ name: "d" })).toEqual({ type: "remove" });
        expect(reduceDashboardKey({ name: "y" })).toEqual({ type: "confirm" });
        expect(reduceDashboardKey({ name: "n" })).toEqual({ type: "cancel" });
        expect(reduceDashboardKey({ name: "escape" })).toEqual({ type: "back" });
    });

    test("ignores unknown keys", () => {
        expect(reduceDashboardKey({ name: "x" })).toEqual({ type: "none" });
    });
});

describe("moveDashboardFocus", () => {
    test("moves up from the first content row to the header", () => {
        expect(moveDashboardFocus({ area: "content", cursor: 0, rowCount: 3 }, -1)).toEqual({
            area: "header",
            cursor: 0,
        });
    });

    test("moves down from the header to the content rows", () => {
        expect(moveDashboardFocus({ area: "header", cursor: 2, rowCount: 3 }, 1)).toEqual({
            area: "content",
            cursor: 2,
        });
    });

    test("moves within content rows without leaving bounds", () => {
        expect(moveDashboardFocus({ area: "content", cursor: 1, rowCount: 3 }, -1)).toEqual({
            area: "content",
            cursor: 0,
        });
        expect(moveDashboardFocus({ area: "content", cursor: 2, rowCount: 3 }, 1)).toEqual({
            area: "content",
            cursor: 2,
        });
    });
});

describe("dashboardSelectionMarker", () => {
    test("moves the visible arrow from content to header when header has focus", () => {
        expect(dashboardSelectionMarker({ focusedArea: "header", itemArea: "content", selected: true })).toBe(" ");
        expect(dashboardSelectionMarker({ focusedArea: "header", itemArea: "header", selected: true })).toBe("▶");
    });

    test("shows the arrow on the selected content row when content has focus", () => {
        expect(dashboardSelectionMarker({ focusedArea: "content", itemArea: "content", selected: true })).toBe("▶");
        expect(dashboardSelectionMarker({ focusedArea: "content", itemArea: "header", selected: true })).toBe(" ");
    });
});
