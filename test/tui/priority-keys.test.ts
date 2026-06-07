import { describe, expect, test } from "bun:test";
import {
	movePriorityFocus,
	prioritySelectionMarker,
	reducePriorityKey,
} from "../../src/tui/priority-keys";

describe("reducePriorityKey", () => {
	test("arrow and vim keys move the cursor", () => {
		expect(reducePriorityKey({ name: "up" })).toEqual({
			delta: -1,
			type: "move-cursor",
		});
		expect(reducePriorityKey({ name: "down" })).toEqual({
			delta: 1,
			type: "move-cursor",
		});
		expect(reducePriorityKey({ name: "k" })).toEqual({
			delta: -1,
			type: "move-cursor",
		});
		expect(reducePriorityKey({ name: "j" })).toEqual({
			delta: 1,
			type: "move-cursor",
		});
	});

	test("shift+arrows reorder the selected provider", () => {
		expect(reducePriorityKey({ name: "up", shift: true })).toEqual({
			direction: -1,
			type: "reorder",
		});
		expect(reducePriorityKey({ name: "down", shift: true })).toEqual({
			direction: 1,
			type: "reorder",
		});
	});

	test("space toggles rotation, enter opens the model picker", () => {
		expect(reducePriorityKey({ name: "space" })).toEqual({
			type: "toggle-enabled",
		});
		expect(reducePriorityKey({ name: "return" })).toEqual({
			type: "open-model",
		});
	});

	test("b toggles balancing and escape goes back", () => {
		expect(reducePriorityKey({ name: "b" })).toEqual({
			type: "toggle-balancing",
		});
		expect(reducePriorityKey({ name: "escape" })).toEqual({ type: "back" });
	});

	test("unmapped keys are ignored", () => {
		expect(reducePriorityKey({ name: "x" })).toEqual({ type: "none" });
	});
});

describe("movePriorityFocus", () => {
	test("moves up from first provider row to the header", () => {
		expect(
			movePriorityFocus({ area: "content", cursor: 0, rowCount: 2 }, -1),
		).toEqual({
			area: "header",
			cursor: 0,
		});
	});

	test("moves down from header to provider rows", () => {
		expect(
			movePriorityFocus({ area: "header", cursor: 0, rowCount: 2 }, 1),
		).toEqual({
			area: "content",
			cursor: 0,
		});
	});

	test("moves within provider rows without leaving bounds", () => {
		expect(
			movePriorityFocus({ area: "content", cursor: 1, rowCount: 2 }, -1),
		).toEqual({
			area: "content",
			cursor: 0,
		});
		expect(
			movePriorityFocus({ area: "content", cursor: 1, rowCount: 2 }, 1),
		).toEqual({
			area: "content",
			cursor: 1,
		});
	});
});

describe("prioritySelectionMarker", () => {
	test("shows the visible arrow on header only when header has focus", () => {
		expect(
			prioritySelectionMarker({
				focusedArea: "header",
				itemArea: "header",
				selected: true,
			}),
		).toBe("▶");
		expect(
			prioritySelectionMarker({
				focusedArea: "header",
				itemArea: "content",
				selected: true,
			}),
		).toBe(" ");
	});

	test("shows the visible arrow on provider row only when content has focus", () => {
		expect(
			prioritySelectionMarker({
				focusedArea: "content",
				itemArea: "content",
				selected: true,
			}),
		).toBe("▶");
		expect(
			prioritySelectionMarker({
				focusedArea: "content",
				itemArea: "header",
				selected: true,
			}),
		).toBe(" ");
	});
});
